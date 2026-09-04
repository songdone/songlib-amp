import AVFoundation
import Combine
import Foundation
import MediaPlayer

/// 播放器。
///
/// 这一版和上一版最根本的区别就在这里：**声音和歌词共用同一个时钟。**
///
/// 上一版是手机出声、服务器另外渲染一路视频流投到电视上，两边各有一个时钟，
/// 于是全部精力都花在对齐它们上（起播点、换歌重新对齐、提前编码的上界……）。
/// 现在电视自己播，`AVPlayer` 的播放头就是唯一的事实 —— 对齐这个问题不是
/// 修好了，是不存在了。
@MainActor
final class MusicPlayer: ObservableObject {
    @Published private(set) var queue: [PlexItem] = []
    @Published private(set) var index: Int = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var lyrics: LyricsTimeline?
    @Published private(set) var lyricsLoading = false
    @Published private(set) var failure: String?

    private let player = AVQueuePlayer()
    private var library: PlexLibrary?
    private var endObserver: AnyCancellable?
    private var lyricsTask: Task<Void, Never>?
    private var reportTask: Task<Void, Never>?
    private var lastReportedSecond = -1

    var currentTrack: PlexItem? {
        guard queue.indices.contains(index) else { return nil }
        return queue[index]
    }

    /// 播放头。歌词界面每帧读一次，所以这里不能有副作用。
    var position: Double {
        let time = player.currentTime()
        guard time.isValid, !time.isIndefinite else { return 0 }
        return max(0, CMTimeGetSeconds(time))
    }

    var duration: Double {
        if let asset = player.currentItem?.duration, asset.isValid, !asset.isIndefinite {
            let seconds = CMTimeGetSeconds(asset)
            if seconds.isFinite, seconds > 0 { return seconds }
        }
        // 资源还没加载完时退回用元数据里的时长，免得进度条一开始是空的。
        return currentTrack?.durationSeconds ?? 0
    }

    init() {
        configureAudioSession()
        observeItemEnd()
        configureRemoteCommands()
    }

    func attach(library: PlexLibrary) {
        self.library = library
    }

    // MARK: - 音频会话

    /// 声明成 `.playback`。
    ///
    /// 不声明的话 tvOS 会当成一段可以被随便打断的音效，切到别的应用就没了；
    /// 也不会出现在系统的"正在播放"里 —— 遥控器上的播放暂停键会失灵。
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            failure = "音频通道打不开：\(error.localizedDescription)"
        }
    }

    // MARK: - 队列

    func play(_ tracks: [PlexItem], startingAt start: Int = 0) {
        guard !tracks.isEmpty else { return }
        queue = tracks
        index = min(max(0, start), tracks.count - 1)
        loadCurrent()
    }

    func next() {
        guard index + 1 < queue.count else {
            stop()
            return
        }
        index += 1
        loadCurrent()
    }

    func previous() {
        // 播过 5 秒以上的话，"上一首"先理解成"重放这一首" —— 和几乎所有
        // 播放器一致，避免手一抖就跳走了。
        if position > 5 {
            seek(to: 0)
            return
        }
        guard index > 0 else {
            seek(to: 0)
            return
        }
        index -= 1
        loadCurrent()
    }

    private func loadCurrent() {
        guard let library, let track = currentTrack else { return }
        guard let url = library.streamURL(for: track) else {
            failure = "《\(track.displayTitle)》没有可直连的音频文件"
            return
        }
        failure = nil
        player.removeAllItems()
        player.insert(AVPlayerItem(url: url), after: nil)
        player.play()
        isPlaying = true
        lastReportedSecond = -1
        loadLyrics(for: track)
        updateNowPlayingInfo()
    }

    // MARK: - 传输控制

    func toggle() {
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
        updateNowPlayingInfo()
        report(state: isPlaying ? "playing" : "paused")
    }

    func seek(to seconds: Double) {
        let clamped = max(0, min(seconds, max(0, duration - 0.5)))
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in self?.updateNowPlayingInfo() }
        }
    }

    func skip(by delta: Double) {
        seek(to: position + delta)
    }

    func stop() {
        player.pause()
        player.removeAllItems()
        isPlaying = false
        report(state: "stopped")
    }

    private func observeItemEnd() {
        endObserver = NotificationCenter.default
            .publisher(for: .AVPlayerItemDidPlayToEndTime)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in self?.next() }
            }
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

    // MARK: - 上报与系统「正在播放」

    /// 每秒最多上报一次，且只在整秒变化时报。
    ///
    /// 歌词界面是按帧刷的，如果跟着它上报，一首歌会给 Plex 打上几千个请求。
    func tick() {
        let second = Int(position)
        guard second != lastReportedSecond else { return }
        lastReportedSecond = second
        if second % 10 == 0 {
            report(state: isPlaying ? "playing" : "paused")
        }
    }

    private func report(state: String) {
        guard let library, let track = currentTrack else { return }
        let at = position
        reportTask?.cancel()
        reportTask = Task { await library.reportTimeline(track: track, positionSeconds: at, state: state) }
    }

    /// 填系统的「正在播放」，遥控器和 Siri 才认得这个播放器。
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
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.isPlaying else { return }
                self.toggle()
            }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isPlaying else { return }
                self.toggle()
            }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
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
