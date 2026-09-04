import AVFoundation
import Combine
import Foundation
import MediaPlayer

/// 播放器：队列、随机、循环、以及那条自己搭的解码链。
///
/// ## 为什么不用 AVPlayer
///
/// 见 `StreamingAudioEngine` 顶部：把 Plex 的原始 `.flac` 地址交给 AVPlayer，
/// 实测 30 秒都不会 ready。裸 FLAC 容器没有索引，AVFoundation 的渐进式 HTTP
/// 通道解析不了它。所以这里走自己的链：边下边解，原始音质，不转码。
///
/// ## 时钟
///
/// 播放位置来自音频引擎的渲染时间，是采样级的。歌词直接挂在它上面 ——
/// 声音和歌词共用一个时钟，"对齐"这个问题在这个架构里不存在。
@MainActor
final class MusicPlayer: ObservableObject {

    enum RepeatMode: String, CaseIterable {
        case off, all, one

        var symbol: String {
            switch self {
            case .off, .all: return "repeat"
            case .one: return "repeat.1"
            }
        }
        var label: String {
            switch self {
            case .off: return "不循环"
            case .all: return "循环全部"
            case .one: return "单曲循环"
            }
        }
        var next: RepeatMode {
            switch self {
            case .off: return .all
            case .all: return .one
            case .one: return .off
            }
        }
    }

    // MARK: - 状态

    /// 播放顺序。随机时它是被打乱过的 —— 打乱一次存下来，而不是每次
    /// "下一首"时随机取一个：后者会让"上一首"没有意义，也可能同一首连续出现。
    @Published private(set) var queue: [PlexItem] = []
    @Published private(set) var index: Int = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var shuffled = false
    @Published private(set) var repeatMode: RepeatMode = .off
    @Published private(set) var lyrics: LyricsTimeline?
    @Published private(set) var lyricsLoading = false
    @Published private(set) var failure: String?

    private let audio = StreamingAudioEngine()
    private var library: PlexLibrary?
    /// 未打乱的原始顺序。关掉随机时要还原回它。
    private var sourceOrder: [PlexItem] = []
    private var lyricsTask: Task<Void, Never>?
    private var reportTask: Task<Void, Never>?
    private var lastReportedSecond = -1

    var currentTrack: PlexItem? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    var upNext: [PlexItem] {
        guard index + 1 < queue.count else { return [] }
        return Array(queue[(index + 1)...])
    }

    var position: Double { audio.position }
    /// 频谱。歌词界面每帧读，所以不走 @Published。
    var spectrum: SpectrumAnalyzer { audio.spectrum }

    var duration: Double {
        let known = audio.duration
        if known > 0 { return known }
        return currentTrack?.durationSeconds ?? 0
    }

    // MARK: -

    init() {
        configureAudioSession()
        configureRemoteCommands()

        audio.onStateChange = { [weak self] state in
            Task { @MainActor in self?.apply(state) }
        }
        audio.onFinished = { [weak self] in
            Task { @MainActor in self?.trackFinished() }
        }
    }

    func attach(library: PlexLibrary) {
        self.library = library
    }

    /// 声明成 `.playback`：不声明的话 tvOS 会当成可以随便打断的音效，
    /// 切走就没了，系统「正在播放」里也不会出现（遥控器的播放键会失灵）。
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            failure = "音频通道打不开：\(error.localizedDescription)"
        }
    }

    private func apply(_ state: StreamingAudioEngine.State) {
        switch state {
        case .idle:
            isPlaying = false; isBuffering = false
        case .buffering:
            isPlaying = false; isBuffering = true
        case .playing:
            isPlaying = true; isBuffering = false; failure = nil
        case .paused:
            isPlaying = false; isBuffering = false
        case .finished:
            isPlaying = false; isBuffering = false
        case .failed(let message):
            isPlaying = false; isBuffering = false; failure = message
        }
        updateNowPlayingInfo()
    }

    // MARK: - 开始播放

    func play(_ tracks: [PlexItem], startingAt start: Int = 0, shuffle: Bool = false) {
        guard !tracks.isEmpty else { return }
        sourceOrder = tracks
        shuffled = shuffle
        if shuffle {
            // 打乱，但把用户点的那首放在第一个 —— 点了某首歌却从别的歌
            // 开始播，是很让人困惑的。
            var rest = tracks
            let picked = rest.remove(at: min(max(0, start), rest.count - 1))
            queue = [picked] + rest.shuffled()
            index = 0
        } else {
            queue = tracks
            index = min(max(0, start), tracks.count - 1)
        }
        loadCurrent()
    }

    func playNext(_ track: PlexItem) {
        guard !queue.isEmpty else { play([track]); return }
        queue.insert(track, at: min(index + 1, queue.count))
    }

    func append(_ tracks: [PlexItem]) {
        guard !queue.isEmpty else { play(tracks); return }
        queue.append(contentsOf: tracks)
        sourceOrder.append(contentsOf: tracks)
    }

    func jump(to target: Int) {
        guard queue.indices.contains(target) else { return }
        index = target
        loadCurrent()
    }

    // MARK: - 传输控制

    func toggle() {
        if isPlaying { audio.pause() } else if currentTrack != nil {
            if case .paused = engineState { audio.resume() } else { loadCurrent() }
        }
        report(state: isPlaying ? "paused" : "playing")
    }

    private var engineState: StreamingAudioEngine.State { audio.state }

    func next() {
        if repeatMode == .one { loadCurrent(); return }
        if index + 1 < queue.count {
            index += 1
            loadCurrent()
            return
        }
        if repeatMode == .all, !queue.isEmpty {
            index = 0
            loadCurrent()
            return
        }
        audio.stop()
        report(state: "stopped")
    }

    func previous() {
        // 播过 5 秒以上，「上一首」先理解成「重放这一首」—— 和几乎所有
        // 播放器一致，免得手一抖就跳走了。
        if position > 5 { loadCurrent(); return }
        guard index > 0 else { loadCurrent(); return }
        index -= 1
        loadCurrent()
    }

    func toggleShuffle() {
        shuffled.toggle()
        guard let current = currentTrack else { return }
        if shuffled {
            var rest = sourceOrder.filter { $0.ratingKey != current.ratingKey }
            queue = [current] + rest.shuffled()
            index = 0
        } else {
            queue = sourceOrder
            index = sourceOrder.firstIndex { $0.ratingKey == current.ratingKey } ?? 0
        }
    }

    func cycleRepeat() {
        repeatMode = repeatMode.next
    }

    func stop() {
        audio.stop()
        report(state: "stopped")
    }

    private func trackFinished() {
        next()
    }

    // MARK: - 装载

    private func loadCurrent() {
        guard let library, let track = currentTrack else { return }
        guard let url = library.streamURL(for: track) else {
            failure = "《\(track.displayTitle)》没有可直连的音频文件"
            return
        }
        failure = nil
        lastReportedSecond = -1
        // token 必须放在 URL 的查询串里（引擎用 URLSession 请求，
        // 这里顺便也把 Plex 的客户端标识带上，服务端日志里能看出是这台电视）。
        audio.play(
            url: url,
            headers: library.connection.headers,
            knownDuration: track.durationSeconds,
            container: track.firstPart?.container,
            cacheKey: track.ratingKey
        )
        loadLyrics(for: track)
        updateNowPlayingInfo()
        report(state: "playing")
    }

    // MARK: - 歌词

    private func loadLyrics(for track: PlexItem) {
        lyricsTask?.cancel()
        lyrics = nil
        lyricsLoading = true
        guard let library else { return }
        lyricsTask = Task { [weak self] in
            let found = try? await library.lyrics(for: track.ratingKey)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self else { return }
                // 歌词回来得晚，可能歌都换了 —— 别把上一首的词贴到这一首上。
                guard self.currentTrack?.ratingKey == track.ratingKey else { return }
                self.lyrics = found
                self.lyricsLoading = false
            }
        }
    }

    // MARK: - 上报 / 系统「正在播放」

    /// 歌词界面按帧刷，如果跟着它上报，一首歌会给 Plex 打几千个请求。
    /// 所以只在整秒变化、且每 10 秒才报一次。
    func tick() {
        let second = Int(position)
        guard second != lastReportedSecond else { return }
        lastReportedSecond = second
        updateNowPlayingInfo()
        if second % 10 == 0 { report(state: isPlaying ? "playing" : "paused") }
    }

    private func report(state: String) {
        guard let library, let track = currentTrack else { return }
        let at = position
        reportTask?.cancel()
        reportTask = Task { await library.reportTimeline(track: track, positionSeconds: at, state: state) }
    }

    private func updateNowPlayingInfo() {
        guard let track = currentTrack else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.displayTitle,
            MPMediaItemPropertyArtist: track.displayArtist,
            MPMediaItemPropertyAlbumTitle: track.displayAlbum,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in if self?.isPlaying == false { self?.toggle() } }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in if self?.isPlaying == true { self?.toggle() } }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
    }
}
