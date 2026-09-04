import SwiftUI

/// 大屏歌词。这个应用存在的理由。
///
/// ## 布局为什么是"歌词占中央"
///
/// 上一版（服务器渲视频投屏）是左边一张封面、右边一列歌词。在 16:9 的电视上
/// 那个版式右侧总是空一大片，歌词被挤在偏左的一条里 —— 看着像个信息面板，
/// 不像在听歌。这一版让歌词居中占据整个画面，封面退到背景里做光和色，
/// 播放信息压到底部一条。三米外只有一件东西该被看见。
///
/// ## 时钟
///
/// 用 `TimelineView(.animation)` 每帧直接读播放头，**不把播放位置放进
/// @Published**。位置一秒变几十次，走 state 会让整棵视图树每帧重算一遍；
/// 而且根本不需要 —— 播放头是现成的事实，读它就行。
///
/// ## 为什么拆成 NowPlayingBody
///
/// 渲染部分不碰 `MusicPlayer`，只吃"当前曲目 + 歌词 + 一个能问出播放头的
/// 闭包"。这样调视觉时可以用真实素材离线渲染（见 PreviewHarness），走的还是
/// **同一套代码**。如果预览另写一份，调出来的版式就是假的。
struct NowPlayingView: View {
    @ObservedObject var player: MusicPlayer
    let library: PlexLibrary?

    var body: some View {
        NowPlayingBody(
            track: player.currentTrack,
            lyrics: player.lyrics,
            lyricsLoading: player.lyricsLoading,
            coverURL: player.currentTrack.flatMap { library?.coverURL(for: $0, size: 720) },
            thumbURL: player.currentTrack.flatMap { library?.coverURL(for: $0, size: 240) },
            isPlaying: player.isPlaying,
            duration: player.duration,
            position: { player.position },
            onSecondTick: { player.tick() }
        )
    }
}

#if DEBUG
/// 离线预览用的入口。刻意跟真机共用 `NowPlayingBody`。
struct NowPlayingPreviewBody: View {
    let track: PlexItem
    let lyrics: LyricsTimeline?
    let coverURL: URL?
    let position: () -> Double

    var body: some View {
        NowPlayingBody(
            track: track,
            lyrics: lyrics,
            lyricsLoading: false,
            coverURL: coverURL,
            thumbURL: coverURL,
            isPlaying: true,
            duration: track.durationSeconds,
            position: position,
            onSecondTick: {}
        )
    }
}
#endif

// MARK: - 纯展示层

struct NowPlayingBody: View {
    let track: PlexItem?
    let lyrics: LyricsTimeline?
    let lyricsLoading: Bool
    let coverURL: URL?
    let thumbURL: URL?
    let isPlaying: Bool
    let duration: Double
    let position: () -> Double
    let onSecondTick: () -> Void

    var body: some View {
        ZStack {
            background
            if let track {
                content(track: track)
            } else {
                Text("没有正在播放的曲目")
                    .font(.system(size: 38, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - 背景

    /// 背景就是那张封面本身：放大、模糊、压暗。
    ///
    /// 不另外提取主色调 —— 模糊后的封面**就是**这首歌的颜色，而且比任何取色
    /// 算法都准。取色算法在灰度封面上会退化成一团脏灰，上一版渲视频时就得
    /// 为这种情况专门写补偿逻辑。
    private var background: some View {
        ZStack {
            Theme.canvas
            if let coverURL {
                CoverImage(url: coverURL, cornerRadius: 0)
                    .scaleEffect(1.35)
                    .blur(radius: 110, opaque: true)
                    .opacity(0.55)
                    .id(coverURL)
            }
            // 压暗层。背景压够暗、最亮的字压在纯白之下，三米外才读得动。
            LinearGradient(
                colors: [
                    Color.black.opacity(0.55),
                    Color.black.opacity(0.42),
                    Color.black.opacity(0.72),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
        .animation(.easeInOut(duration: 0.8), value: coverURL)
    }

    // MARK: - 主体

    private func content(track: PlexItem) -> some View {
        TimelineView(.animation) { timeline in
            let _ = timeline.date   // 每帧重算
            let at = position()
            VStack(spacing: 0) {
                lyricsArea(position: at, track: track)
                    .frame(maxHeight: .infinity)
                transportBar(track: track, position: at)
            }
            .padding(.horizontal, Theme.screenPadding)
            .padding(.vertical, 60)
            .onChange(of: Int(at)) { _, _ in onSecondTick() }
        }
    }

    // MARK: - 歌词区

    @ViewBuilder
    private func lyricsArea(position at: Double, track: PlexItem) -> some View {
        if let lyrics, !lyrics.isEmpty {
            LyricsScroller(lyrics: lyrics, position: at)
        } else if lyricsLoading {
            Text("正在取歌词…")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            noLyrics(track: track)
        }
    }

    /// 没有歌词时不留白 —— 把封面放大居中，做成一个体面的"纯听"界面。
    private func noLyrics(track: PlexItem) -> some View {
        VStack(spacing: 34) {
            CoverImage(url: thumbURL, cornerRadius: 24, fallbackText: track.displayTitle)
                .frame(width: 420, height: 420)
                .shadow(color: .black.opacity(0.6), radius: 40, y: 18)
            Text("这首没有歌词")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - 底部信息条

    private func transportBar(track: PlexItem, position at: Double) -> some View {
        VStack(spacing: 18) {
            HStack(spacing: 26) {
                CoverImage(url: thumbURL, cornerRadius: 12, fallbackText: track.displayTitle)
                    .frame(width: 116, height: 116)
                    .shadow(color: .black.opacity(0.5), radius: 18, y: 8)

                VStack(alignment: .leading, spacing: 8) {
                    Text(track.displayTitle)
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    HStack(spacing: 12) {
                        Text(track.displayArtist).lineLimit(1)
                        if !track.displayAlbum.isEmpty {
                            Text("·")
                            Text(track.displayAlbum).lineLimit(1)
                        }
                    }
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                }

                Spacer(minLength: 20)

                // 音质角标。用户明确说过不喜欢转码播放 —— 如实标出现在放的是
                // 什么，直连无损就该看得见。
                if let codec = track.audioCodec {
                    Text(qualityLabel(codec: codec, bitrate: track.bitrate))
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Color.white.opacity(0.10)))
                        .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
                }
            }

            progress(position: at)
        }
    }

    private func qualityLabel(codec: String, bitrate: Int?) -> String {
        let name = codec.uppercased()
        if ["FLAC", "ALAC", "PCM", "WAV", "APE", "DSD"].contains(name) {
            return "\(name) · 无损直连"
        }
        if let bitrate, bitrate > 0 { return "\(name) \(bitrate)k" }
        return name
    }

    private func progress(position at: Double) -> some View {
        VStack(spacing: 10) {
            GeometryReader { geometry in
                let fraction = duration > 0 ? min(1, max(0, at / duration)) : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.16))
                    Capsule()
                        .fill(Color.white.opacity(0.85))
                        .frame(width: geometry.size.width * fraction)
                }
            }
            .frame(height: 6)

            HStack {
                Text(timeText(at))
                Spacer()
                if !isPlaying {
                    Text("已暂停").foregroundStyle(Theme.textTertiary)
                    Spacer()
                }
                Text(timeText(duration))
            }
            .font(.system(size: 24, weight: .medium).monospacedDigit())
            .foregroundStyle(Theme.textSecondary)
        }
    }

    private func timeText(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

// MARK: - 歌词滚动

/// 歌词的滚动和高亮。
///
/// **每行占一个等高的槽位**，靠 `offset` 把当前行推到画面中央。行高不等的话
/// 这个位移就算不准（一句换行会把它后面所有行推偏），所以宁可让长句缩字号
/// 也不让它换行 —— 电视上一句一行本来也更好读。
private struct LyricsScroller: View {
    let lyrics: LyricsTimeline
    let position: Double

    /// 槽位高度：主行字号 62 + 上下留白。
    private let slot: CGFloat = 112

    var body: some View {
        let active = lyrics.activeIndex(at: position)
        // 前奏/间奏时没有当前行，但画面不能跳回顶部 —— 停在上一句那儿。
        let anchor = active ?? lastPassed

        GeometryReader { geometry in
            let center = geometry.size.height / 2 - slot / 2
            VStack(spacing: 0) {
                ForEach(Array(lyrics.lines.enumerated()), id: \.element.id) { index, line in
                    lineView(line: line, distance: index - anchor, isActive: index == active)
                        .frame(height: slot)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
            .offset(y: center - CGFloat(anchor) * slot)
            .animation(.spring(response: 0.55, dampingFraction: 0.82), value: anchor)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .center) {
                // 制作名单只在真正的前奏里出现一次，不参与滚动。
                if active == nil, !lyrics.credits.isEmpty, position < firstLineStart {
                    creditsCard
                }
            }
            // 上下淡出，避免歌词被画面边缘硬切断。
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .black, location: 0.22),
                        .init(color: .black, location: 0.78),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
            )
        }
    }

    private var firstLineStart: Double { lyrics.lines.first?.start ?? 0 }

    private var lastPassed: Int {
        lyrics.lines.lastIndex(where: { $0.start <= position }) ?? 0
    }

    private var creditsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(lyrics.credits, id: \.self) { credit in
                Text(credit)
                    .font(.system(size: 26, weight: .regular))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 22)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.06))
        )
    }

    private func lineView(line: LyricsTimeline.Line, distance: Int, isActive: Bool) -> some View {
        Text(line.text)
            .font(.lyric(isActive ? Theme.lyricActiveSize : Theme.lyricIdleSize,
                         weight: isActive ? .bold : .medium))
            .foregroundStyle(color(for: abs(distance), isActive: isActive))
            .lineLimit(1)
            // 长句缩字号而不换行：换行会让槽位高度失准，滚动就对不上了。
            .minimumScaleFactor(0.5)
            .multilineTextAlignment(.center)
            .shadow(color: isActive ? Color.black.opacity(0.55) : .clear, radius: 18, y: 4)
            .padding(.horizontal, 40)
    }

    /// 越远越暗，但不暗到看不见 —— 上下几句还看得见，才有"歌在往前走"的感觉。
    private func color(for magnitude: Int, isActive: Bool) -> Color {
        if isActive { return Theme.lyricActive }
        switch magnitude {
        case 0, 1: return Theme.lyricNear
        case 2: return Color.white.opacity(0.30)
        default: return Theme.lyricFar
        }
    }
}
