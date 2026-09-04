import AVFoundation
import AudioToolbox
import Foundation

/// 边下边解的音频引擎 —— 原始文件、原始音质、不转码。
///
/// ## 为什么不能用 AVPlayer
///
/// 第一版直接把 Plex 的 `Part.key`（也就是原始 `.flac` 文件的地址）交给
/// `AVPlayer`。结果实测：`isPlayable` 返回 true、时长也读得出来（301.58 秒、
/// flac 44100 立体声），但 **30 秒后 `item.status` 始终是 `unknown`、播放头
/// 一直是 0**，永远不会 ready。
///
/// 这跟带宽、跟公网都没有关系 —— 是 AVFoundation 对**裸 FLAC 容器**的限制：
/// 裸 `.flac` 没有 moov、没有 seek table，AVPlayer 的渐进式 HTTP 通道没法
/// 增量解析它。同一个解码器在本地完整文件上是好的，换成 HTTP 就不行。
///
/// ## 所以自己搭这条链
///
/// ```
/// URLSession 分块下载
///        ↓  原始字节
/// AudioFileStream        —— 增量解析出音频包（实测支持 kAudioFileFLACType）
///        ↓  packets + AudioStreamPacketDescription
/// AudioConverter         —— FLAC 包 → PCM，无损
///        ↓  Float32 PCM
/// AVAudioEngine          —— 播
/// ```
///
/// 这就是 Plexamp 自带引擎在做的事。代价是这三百行；换来的是原始音质直连，
/// 一个字节都不重新编码。
///
/// ## 时钟
///
/// 播放位置取自 `AVAudioPlayerNode` 的渲染时间，是**采样级**的 —— 歌词
/// 就挂在这个时钟上。这也是这一版和"服务器渲视频投屏"那一版的根本区别：
/// 声音和歌词共用一个时钟，对齐问题不存在。
/// 输入回调"暂时没料了"的返回码。
///
/// AudioToolbox 没有为这件事定义常量 —— 惯例是自己返回一个非零码，
/// `AudioConverterFillComplexBuffer` 会把它原样传回来，调用方据此判断
/// 是"喂完了"还是"真出错了"。
private let noMoreDataStatus: OSStatus = -0x4E4F444D   // 'NODM'

final class StreamingAudioEngine {

    enum State: Equatable {
        case idle
        case buffering
        case playing
        case paused
        case finished
        case failed(String)
    }

    // MARK: - 对外

    private(set) var state: State = .idle {
        didSet { if oldValue != state { onStateChange?(state) } }
    }
    var onStateChange: ((State) -> Void)?
    /// 一首播完（自然结束，不是被切走）。
    var onFinished: (() -> Void)?

    /// 播放位置（秒）。歌词每帧读它，所以必须便宜且无副作用。
    var position: Double {
        lock.lock()
        let base = seekOffsetSeconds
        let frames = renderedFrames
        let rate = outputFormat?.sampleRate ?? 44100
        lock.unlock()
        return base + Double(frames) / rate
    }

    /// 已知总时长（秒）。裸 FLAC 的时长要等解析出 STREAMINFO 才知道，
    /// 所以先用 Plex 元数据里的值兜底。
    private(set) var duration: Double = 0

    // MARK: - 内部

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    /// 频谱分析器。装在主混音节点上 —— 它拿到的就是最终送到扬声器的样本。
    let spectrum = SpectrumAnalyzer()
    private let lock = NSLock()

    private var streamID: AudioFileStreamID?
    private var converter: AudioConverterRef?
    private var sourceFormat = AudioStreamBasicDescription()
    private var outputFormat: AVAudioFormat?

    /// 解析出来但还没解码的包。
    private var packets: [(data: Data, desc: AudioStreamPacketDescription)] = []
    private var reachedEndOfStream = false
    private var renderedFrames: AVAudioFramePosition = 0
    private var seekOffsetSeconds: Double = 0
    private var scheduledFrames: AVAudioFramePosition = 0

    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var delegate: StreamDelegate?
    private var decodeQueue = DispatchQueue(label: "songlib.decode", qos: .userInitiated)
    private var decoding = false
    private var writer: CacheWriter?

    /// 从本地文件喂解析器。分块读，和网络路径走同一条解码链。
    private func feedLocalFile(_ url: URL) {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            state = .failed("本地缓存读不出来")
            return
        }
        decodeQueue.async { [weak self] in
            while let chunk = try? handle.read(upToCount: 128 * 1024), !chunk.isEmpty {
                guard let self, self.streamID != nil else { break }
                self.received(chunk)
            }
            try? handle.close()
            self?.completed(error: nil)
        }
    }

    /// 起播前先囤够这么多包再开声。
    ///
    /// 太小会一开声就断（公网抖一下就没了）；太大起播慢。FLAC 一包约
    /// 4096 帧 ≈ 93ms，250 包 ≈ 23 秒 —— 对 1500kbps 的无损来说，这段
    /// 缓冲在实测约 3.4Mbps 的链路上大概 10 秒能囤出来。
    private let prerollPackets = 250
    /// 每次交给引擎的 PCM 帧数。
    private let renderChunkFrames: AVAudioFrameCount = 8192

    // MARK: - 生命周期

    init() {
        engine.attach(playerNode)
    }

    deinit {
        teardown()
    }

    /// 开始播一个地址。
    ///
    /// `cacheKey` 给了就参与离线缓存：本地已有完整副本时直接读盘（起播即时、
    /// 不占带宽）；没有则边流边落盘，下次就是本地的了。
    func play(url: URL, headers: [String: String], knownDuration: Double,
              container: String?, cacheKey: String? = nil) {
        teardown()
        duration = knownDuration
        state = .buffering

        let hint = Self.fileTypeHint(for: container, url: url)
        var stream: AudioFileStreamID?
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        let status = AudioFileStreamOpen(selfPtr, Self.propertyCallback, Self.packetsCallback, hint, &stream)
        guard status == noErr, let stream else {
            state = .failed("解析器打不开（\(status)）")
            return
        }
        streamID = stream

        // 本地有完整副本就直接喂文件，一个字节都不用走网络。
        if let cacheKey, let local = MainActor.assumeIsolated({ OfflineCache.shared.localFile(for: cacheKey) }) {
            feedLocalFile(local)
            return
        }
        if let cacheKey {
            writer = MainActor.assumeIsolated { OfflineCache.shared.beginWrite(for: cacheKey) }
        }

        var request = URLRequest(url: url)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.timeoutInterval = 30
        // 音频要边下边播，不能等整个文件。
        request.networkServiceType = .avStreaming

        let delegate = StreamDelegate(owner: self)
        self.delegate = delegate
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func pause() {
        guard state == .playing else { return }
        playerNode.pause()
        engine.pause()
        state = .paused
    }

    func resume() {
        guard state == .paused else { return }
        try? engine.start()
        playerNode.play()
        state = .playing
    }

    func stop() {
        teardown()
        state = .idle
    }

    private func teardown() {
        // 切歌时把半成品丢掉 —— 截断的文件不能当缓存用。
        writer?.close(complete: false)
        writer = nil
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        delegate = nil
        if playerNode.isPlaying { playerNode.stop() }
        spectrum.detach(from: engine)
        if engine.isRunning { engine.stop() }
        if let streamID { AudioFileStreamClose(streamID) }
        streamID = nil
        if let converter { AudioConverterDispose(converter) }
        converter = nil
        lock.lock()
        packets.removeAll()
        renderedFrames = 0
        scheduledFrames = 0
        seekOffsetSeconds = 0
        reachedEndOfStream = false
        decoding = false
        lock.unlock()
        outputFormat = nil
    }

    /// 容器类型提示。给对了能让解析器少猜一步；给不上就传 0 让它自己嗅探。
    private static func fileTypeHint(for container: String?, url: URL) -> AudioFileTypeID {
        let name = (container ?? url.pathExtension).lowercased()
        switch name {
        case "flac": return kAudioFileFLACType
        case "mp3": return kAudioFileMP3Type
        case "m4a", "mp4", "aac": return kAudioFileM4AType
        case "alac": return kAudioFileM4AType
        case "wav": return kAudioFileWAVEType
        case "aiff", "aif": return kAudioFileAIFFType
        case "caf": return kAudioFileCAFType
        default: return 0
        }
    }

    // MARK: - AudioFileStream 回调

    private static let propertyCallback: AudioFileStream_PropertyListenerProc = { userData, streamID, propertyID, flags in
        let engine = Unmanaged<StreamingAudioEngine>.fromOpaque(userData).takeUnretainedValue()
        engine.handleProperty(streamID: streamID, propertyID: propertyID)
    }

    private static let packetsCallback: AudioFileStream_PacketsProc = { userData, byteCount, packetCount, data, descriptions in
        let engine = Unmanaged<StreamingAudioEngine>.fromOpaque(userData).takeUnretainedValue()
        engine.handlePackets(byteCount: byteCount, packetCount: packetCount, data: data, descriptions: descriptions)
    }

    private func handleProperty(streamID: AudioFileStreamID, propertyID: AudioFileStreamPropertyID) {
        switch propertyID {
        case kAudioFileStreamProperty_DataFormat:
            var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var format = AudioStreamBasicDescription()
            guard AudioFileStreamGetProperty(streamID, propertyID, &size, &format) == noErr else { return }
            sourceFormat = format
            setUpConverter()

        case kAudioFileStreamProperty_AudioDataPacketCount:
            // 有总包数就能算出准确时长（比 Plex 元数据更可靠）。
            var size = UInt32(MemoryLayout<UInt64>.size)
            var count: UInt64 = 0
            guard AudioFileStreamGetProperty(streamID, propertyID, &size, &count) == noErr,
                  sourceFormat.mSampleRate > 0, sourceFormat.mFramesPerPacket > 0 else { return }
            let seconds = Double(count) * Double(sourceFormat.mFramesPerPacket) / sourceFormat.mSampleRate
            if seconds > 0 { duration = seconds }

        default:
            break
        }
    }

    private func handlePackets(
        byteCount: UInt32, packetCount: UInt32,
        data: UnsafeRawPointer,
        descriptions: UnsafeMutablePointer<AudioStreamPacketDescription>?
    ) {
        guard packetCount > 0 else { return }
        var collected: [(Data, AudioStreamPacketDescription)] = []
        collected.reserveCapacity(Int(packetCount))

        if let descriptions {
            // 变长包（FLAC、MP3 都是）：每包的偏移和大小由描述给出。
            for index in 0..<Int(packetCount) {
                let desc = descriptions[index]
                let start = data.advanced(by: Int(desc.mStartOffset))
                let bytes = Data(bytes: start, count: Int(desc.mDataByteSize))
                var normalized = desc
                normalized.mStartOffset = 0
                collected.append((bytes, normalized))
            }
        } else {
            // 定长包（PCM/WAV）：自己按每包字节数切。
            let bytesPerPacket = Int(sourceFormat.mBytesPerPacket)
            guard bytesPerPacket > 0 else { return }
            for index in 0..<Int(packetCount) {
                let start = data.advanced(by: index * bytesPerPacket)
                let bytes = Data(bytes: start, count: bytesPerPacket)
                var desc = AudioStreamPacketDescription()
                desc.mStartOffset = 0
                desc.mDataByteSize = UInt32(bytesPerPacket)
                desc.mVariableFramesInPacket = 0
                collected.append((bytes, desc))
            }
        }

        lock.lock()
        packets.append(contentsOf: collected)
        let buffered = packets.count
        lock.unlock()

        // 囤够了就开声。
        if state == .buffering, buffered >= prerollPackets {
            startPlayback()
        }
        pumpDecoder()
    }

    // MARK: - 解码与播放

    private func setUpConverter() {
        guard converter == nil, sourceFormat.mSampleRate > 0 else { return }
        // 输出统一成 Float32 非交错 —— AVAudioEngine 的原生格式，
        // 少一次转换。采样率和声道数**保持源文件不变**，不做任何重采样：
        // 重采样就不是原始音质了。
        guard let output = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sourceFormat.mSampleRate,
            channels: AVAudioChannelCount(max(1, sourceFormat.mChannelsPerFrame)),
            interleaved: false
        ) else {
            state = .failed("输出格式建不出来")
            return
        }
        outputFormat = output

        var destination = output.streamDescription.pointee
        var newConverter: AudioConverterRef?
        let status = AudioConverterNew(&sourceFormat, &destination, &newConverter)
        guard status == noErr, let newConverter else {
            state = .failed("解码器建不出来（\(status)）")
            return
        }
        converter = newConverter

        engine.connect(playerNode, to: engine.mainMixerNode, format: output)
    }

    private func startPlayback() {
        guard let outputFormat else { return }
        do {
            try engine.start()
        } catch {
            state = .failed("音频引擎启动失败：\(error.localizedDescription)")
            return
        }
        // tap 必须在 engine.start() 之后装：引擎没跑起来时主混音节点的
        // 格式还没定，此时装 tap 拿到的会是 0 声道。
        spectrum.attach(to: engine)
        playerNode.play()
        state = .playing
        _ = outputFormat
        pumpDecoder()
    }

    /// 把已解析的包解码成 PCM 并排进播放队列。
    ///
    /// 只允许一个解码循环在跑（`decoding` 标志），否则多个回调同时进来会
    /// 抢同一个 AudioConverter —— 它不是线程安全的。
    private func pumpDecoder() {
        lock.lock()
        if decoding { lock.unlock(); return }
        decoding = true
        lock.unlock()

        decodeQueue.async { [weak self] in
            guard let self else { return }
            defer {
                self.lock.lock()
                self.decoding = false
                self.lock.unlock()
            }
            while self.decodeNextChunk() {
                // 队列里排够 4 块就歇一歇，别把整首歌一次全解出来占内存。
                if self.scheduledFrames - self.renderedFrames
                    > AVAudioFramePosition(self.renderChunkFrames * 4) {
                    return
                }
            }
        }
    }

    /// 解一块。返回 false 表示暂时没料可解了。
    private func decodeNextChunk() -> Bool {
        guard let converter, let outputFormat, state != .idle else { return false }

        lock.lock()
        let available = packets.count
        let ended = reachedEndOfStream
        lock.unlock()
        guard available > 0 else {
            if ended { finishIfDrained() }
            return false
        }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: renderChunkFrames) else {
            return false
        }
        buffer.frameLength = renderChunkFrames

        var framesOut = renderChunkFrames
        let context = DecodeContext(engine: self)
        let contextPtr = Unmanaged.passUnretained(context).toOpaque()

        let status = AudioConverterFillComplexBuffer(
            converter,
            Self.converterInput,
            contextPtr,
            &framesOut,
            buffer.mutableAudioBufferList,
            nil
        )

        guard status == noErr || status == noMoreDataStatus, framesOut > 0 else {
            if ended { finishIfDrained() }
            return false
        }
        buffer.frameLength = framesOut

        lock.lock()
        scheduledFrames += AVAudioFramePosition(framesOut)
        lock.unlock()

        playerNode.scheduleBuffer(buffer) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.renderedFrames += AVAudioFramePosition(framesOut)
            self.lock.unlock()
            self.pumpDecoder()
        }
        return true
    }

    private func finishIfDrained() {
        lock.lock()
        let empty = packets.isEmpty
        let done = scheduledFrames > 0 && renderedFrames >= scheduledFrames
        lock.unlock()
        guard empty, done, state == .playing else { return }
        state = .finished
        onFinished?()
    }

    /// AudioConverter 要料时的回调：从包队列里取。
    private static let converterInput: AudioConverterComplexInputDataProc = {
        _, packetCount, bufferList, descriptions, userData in
        guard let userData else { packetCount.pointee = 0; return noMoreDataStatus }
        let context = Unmanaged<DecodeContext>.fromOpaque(userData).takeUnretainedValue()
        return context.provide(packetCount: packetCount, bufferList: bufferList, descriptions: descriptions)
    }

    /// 一次解码调用期间，转换器可能多次回调要料。这个对象负责在这段时间里
    /// 持有取出来的包的内存 —— 转换器拿的是裸指针，不能让 Data 提前释放。
    private final class DecodeContext {
        private weak var engine: StreamingAudioEngine?
        private var held: [Data] = []
        private var descs: [AudioStreamPacketDescription] = []

        init(engine: StreamingAudioEngine) { self.engine = engine }

        func provide(
            packetCount: UnsafeMutablePointer<UInt32>,
            bufferList: UnsafeMutablePointer<AudioBufferList>,
            descriptions: UnsafeMutablePointer<UnsafeMutablePointer<AudioStreamPacketDescription>?>?
        ) -> OSStatus {
            guard let engine else { packetCount.pointee = 0; return noMoreDataStatus }
            engine.lock.lock()
            guard let first = engine.packets.first else {
                engine.lock.unlock()
                packetCount.pointee = 0
                return noMoreDataStatus
            }
            engine.packets.removeFirst()
            engine.lock.unlock()

            held.append(first.data)
            descs = [first.desc]

            let data = held[held.count - 1]
            data.withUnsafeBytes { raw in
                bufferList.pointee.mNumberBuffers = 1
                bufferList.pointee.mBuffers.mNumberChannels = engine.sourceFormat.mChannelsPerFrame
                bufferList.pointee.mBuffers.mDataByteSize = UInt32(data.count)
                bufferList.pointee.mBuffers.mData = UnsafeMutableRawPointer(mutating: raw.baseAddress)
            }
            packetCount.pointee = 1
            if let descriptions {
                descs.withUnsafeMutableBufferPointer { pointer in
                    descriptions.pointee = pointer.baseAddress
                }
            }
            return noErr
        }
    }

    // MARK: - 网络回调

    fileprivate func received(_ data: Data) {
        guard let streamID else { return }
        writer?.write(data)
        let status = data.withUnsafeBytes { raw in
            AudioFileStreamParseBytes(streamID, UInt32(data.count), raw.baseAddress, [])
        }
        if status != noErr {
            state = .failed("音频流解析失败（\(status)）")
        }
    }

    fileprivate func completed(error: Error?) {
        if let error, (error as NSError).code != NSURLErrorCancelled {
            writer?.close(complete: false)
            writer = nil
            state = .failed("下载中断：\(error.localizedDescription)")
            return
        }
        writer?.close(complete: error == nil)
        writer = nil
        lock.lock()
        reachedEndOfStream = true
        let buffered = packets.count
        lock.unlock()
        // 整首歌比预缓冲还短的情况（很短的曲目），下完就得开声。
        if state == .buffering, buffered > 0 {
            startPlayback()
        }
        pumpDecoder()
    }

    private final class StreamDelegate: NSObject, URLSessionDataDelegate {
        private weak var owner: StreamingAudioEngine?
        init(owner: StreamingAudioEngine) { self.owner = owner }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            owner?.received(data)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            owner?.completed(error: error)
        }
    }
}
