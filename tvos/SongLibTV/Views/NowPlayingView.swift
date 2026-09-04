import SwiftUI

/// 大屏歌词。这个应用存在的理由。
///
/// ## 为什么所有尺寸都是显式算出来的
///
/// 这一页重写过三次，前两次都栽在 SwiftUI 的隐式尺寸协商上：
///
/// - 第一版 `VStack { 歌词.frame(maxHeight:.infinity); 信息条 }` —— 整块比
///   屏幕高，信息条被挤出画面。
/// - 第二版 `ZStack(.bottom) { 歌词.frame(maxHeight:.infinity).padding(.bottom,210) }`
///   —— 「先占满可用高度、再加 210 边距」= 可用高度 + 210，必然溢出。
/// - 第三版换成 `safeAreaInset` 之后高度对了，但歌词整层被莫名右推 371pt
///   （染色量出来的：那一层的 frame 从 461pt 开始，而不是 90pt）。
///
/// 每次都是"某一层的固有尺寸和父容器的提议打起来"。所以这一版**不参与协商**：
/// 顶层一个 `GeometryReader` 拿到画面尺寸，剩下每一块的宽高和位置全部自己算。
/// 代价是多几行算术，换来的是版式完全可预测 —— 而要做到精确的视觉，本来也
/// 只能这么做。
struct NowPlayingView: View {
    @ObservedObject var player: MusicPlayer
    let library: PlexLibrary?

    var body: some View {
        NowPlayingBody(
            track: player.currentTrack,
            lyrics: player.lyrics,
            lyricsLoading: player.lyricsLoading,
            coverURL: player.currentTrack.flatMap { library?.coverURL(for: $0, size: 900) },
            thumbURL: player.currentTrack.flatMap { library?.coverURL(for: $0, size: 300) },
            isPlaying: player.isPlaying,
            duration: player.duration,
            position: { player.position },
            onSecondTick: { player.tick() },
            controls: AnyView(TransportControls(player: player))
        )
    }
}

#if DEBUG
/// 离线预览入口。刻意跟真机共用 `NowPlayingBody` —— 预览另写一份的话，
/// 调出来的版式就是假的。
struct NowPlayingPreviewBody: View {
    let track: PlexItem
    let lyrics: LyricsTimeline?
    let coverURL: URL?
    let position: () -> Double

    var body: some View {
        NowPlayingBody(
            track: track, lyrics: lyrics, lyricsLoading: false,
            coverURL: coverURL, thumbURL: coverURL,
            isPlaying: true, duration: track.durationSeconds,
            position: position, onSecondTick: {},
            controls: nil
        )
    }
}
#endif

// MARK: -

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
    /// 走带控制。离线预览时为 nil —— 预览没有真的播放器可以控制。
    let controls: AnyView?

    /// 底部信息条的高度。显式写死，因为整页的布局算术要靠它。
    private var barHeight: CGFloat { controls == nil ? 168 : 262 }
    /// 歌词区和信息条之间的呼吸。
    private let barGap: CGFloat = 44

    var body: some View {
        GeometryReader { geometry in
            let W = geometry.size.width
            let H = geometry.size.height
            let contentW = W - Theme.screenH * 2
            // 歌词区吃掉整个画面高度，信息条**浮在它上面**，不占位置。
            //
            // 先前是把条的高度从歌词区里扣掉，结果歌词那一列的中心落在画面
            // 40% 处，构图整体偏上，条和最后一句之间还空出一大块。让条浮起来，
            // 歌词就正好以画面中心为轴 —— 底部那道渐隐蒙版负责让字在碰到条
            // 之前就消失，两者不会打架。
            let lyricsH = H - Theme.screenV * 2

            ZStack(alignment: .topLeading) {
                AmbientBackground(coverURL: coverURL)
                    .frame(width: W, height: H)

                if let track {
                    TimelineView(.animation) { timeline in
                        let _ = timeline.date          // 每帧重算
                        let at = position()

                        ZStack(alignment: .topLeading) {
                            lyricsLayer(width: contentW, height: lyricsH, at: at, track: track)
                                .frame(width: contentW, height: lyricsH)
                                .offset(x: Theme.screenH, y: Theme.screenV)

                            TransportBar(
                                track: track, thumbURL: thumbURL,
                                position: at, duration: duration, isPlaying: isPlaying,
                                controls: controls
                            )
                            .frame(width: contentW, height: barHeight)
                            .offset(x: Theme.screenH, y: H - Theme.screenV - barHeight)
                        }
                        .frame(width: W, height: H, alignment: .topLeading)
                        .onChange(of: Int(at)) { _, _ in onSecondTick() }
                    }
                } else {
                    Text("没有正在播放的曲目")
                        .font(.tv(Theme.Size.body))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: W, height: H)
                }
            }
            .frame(width: W, height: H, alignment: .topLeading)
        }
        .background(Theme.canvas)
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func lyricsLayer(width: CGFloat, height: CGFloat, at: Double, track: PlexItem) -> some View {
        if let lyrics, !lyrics.isEmpty {
            LyricsStage(lyrics: lyrics, position: at, width: width, height: height)
        } else if lyricsLoading {
            centered(width: width, height: height) {
                Text("正在取歌词…")
                    .font(.tv(Theme.Size.body))
                    .foregroundStyle(Theme.textTertiary)
            }
        } else {
            // 没有歌词不留白 —— 放大封面，做成一个体面的"纯听"界面。
            centered(width: width, height: height) {
                VStack(spacing: 30) {
                    ArtworkTile(url: thumbURL, fallback: track.displayTitle, side: min(460, height * 0.72))
                    Text("这首没有歌词")
                        .font(.tv(Theme.Size.caption))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        }
    }

    private func centered<Content: View>(
        width: CGFloat, height: CGFloat, @ViewBuilder _ content: () -> Content
    ) -> some View {
        content().frame(width: width, height: height, alignment: .center)
    }
}

// MARK: - 背景

/// 背景就是那张封面本身：放大、模糊、压暗，再让它极慢地漂。
///
/// 不另外提取主色调 —— 模糊后的封面**就是**这首歌的颜色，比任何取色算法都准
/// （取色算法在灰度封面上会退化成一团脏灰，上一版渲视频时得专门为此写补偿）。
///
/// 那个漂移是这一页"活着"的关键。完全静止的模糊底图在大屏上会显得像一张
/// 贴图；让它用 30 秒走完一个来回，快到能感觉到、慢到不抢注意力。
private struct AmbientBackground: View {
    let coverURL: URL?
    @State private var drifted = false

    var body: some View {
        ZStack {
            Theme.canvas
            if let coverURL {
                CoverImage(url: coverURL, cornerRadius: 0)
                    .scaleEffect(drifted ? 1.46 : 1.30)
                    .offset(x: drifted ? -38 : 38, y: drifted ? 26 : -26)
                    .blur(radius: 120, opaque: true)
                    .saturation(1.25)
                    .opacity(0.78)
                    .id(coverURL)
                    .transition(.opacity)
            }
            // 压暗层。上下重、中间轻 —— 让歌词所在的那条带子最亮。
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.58), location: 0.00),
                    .init(color: .black.opacity(0.24), location: 0.38),
                    .init(color: .black.opacity(0.34), location: 0.66),
                    .init(color: .black.opacity(0.80), location: 1.00),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
        .clipped()
        .animation(Theme.Motion.ambient, value: coverURL)
        .onAppear {
            withAnimation(.easeInOut(duration: 30).repeatForever(autoreverses: true)) {
                drifted = true
            }
        }
    }
}

// MARK: - 歌词舞台

/// 歌词的滚动、高亮和景深。
///
/// 位置是**算出来的**，不是让 SwiftUI 分配的：一列等高槽位，总高 n×槽高，
/// 在容器里居中，于是把第 i 行推到正中所需的位移是
/// `总高/2 − i×槽高 − 槽高/2`。闭式解，不需要问任何人容器多高。
private struct LyricsStage: View {
    let lyrics: LyricsTimeline
    let position: Double
    let width: CGFloat
    let height: CGFloat

    private var slot: CGFloat { Theme.Size.lyricSlot }

    var body: some View {
        let active = lyrics.activeIndex(at: position)
        // 前奏/间奏时没有当前行，但画面不能跳回顶部 —— 停在上一句那儿。
        let anchor = active ?? lastPassed
        let total = CGFloat(lyrics.lines.count) * slot

        // 三种状态，界面完全不同：
        //   前奏  —— 还没唱第一句：只显示制作名单，歌词整列让位。
        //   间奏  —— 唱过了但这一段没词：歌词列留着（要看得见上下文），
        //            但整列往下挪半格，把正中让给呼吸指示。
        //   在唱  —— 正常滚动。
        let isIntro = active == nil && position < firstLineStart
        let isInterlude = active == nil && position >= firstLineStart

        ZStack {
            VStack(spacing: 0) {
                ForEach(Array(lyrics.lines.enumerated()), id: \.element.id) { index, line in
                    LyricLine(
                        text: line.text,
                        distance: index - anchor,
                        isActive: index == active
                    )
                    .frame(width: width, height: slot)
                }
            }
            .frame(width: width, height: total)
            // 间奏时挪半格：上一句停在中心偏上、下一句在中心偏下，
            // 正中那道空档正好给呼吸指示站。不挪的话点会压在字上。
            .offset(y: total / 2 - CGFloat(anchor) * slot - slot / 2
                       + (isInterlude ? slot / 2 : 0))
            // 前奏时整列淡出。先前没做这件事，结果制作名单和第一句歌词
            // 叠在一起糊成一团 —— 截图上一眼就能看到。
            .opacity(isIntro ? 0 : 1)
            .animation(Theme.Motion.lyric, value: anchor)
            .animation(Theme.Motion.content, value: isIntro)
            .animation(Theme.Motion.lyric, value: isInterlude)

            if isIntro {
                IntroCard(credits: lyrics.credits)
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            if isInterlude {
                BreathingDots()
                    .transition(.opacity)
            }
        }
        .animation(Theme.Motion.content, value: isIntro)
        .frame(width: width, height: height)
        .clipped()
        // 上下淡出，避免歌词被画面边缘硬切断。
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.00),
                    .init(color: .black, location: 0.24),
                    .init(color: .black, location: 0.76),
                    .init(color: .clear, location: 1.00),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .frame(width: width, height: height)
        )
    }

    private var firstLineStart: Double { lyrics.lines.first?.start ?? 0 }

    private var lastPassed: Int {
        lyrics.lines.lastIndex(where: { $0.start <= position }) ?? 0
    }
}

/// 一行歌词。
///
/// 远离当前行的行会**逐渐失焦**（模糊 + 变暗 + 缩小）。这层景深是"高级感"
/// 里最便宜也最有效的一笔：人眼对模糊的深度线索非常敏感，一加上，那列字
/// 就从"一张列表"变成"一个有前后关系的空间"。
private struct LyricLine: View {
    let text: String
    let distance: Int
    let isActive: Bool

    private var magnitude: Int { abs(distance) }

    var body: some View {
        Text(text)
            .font(.tv(isActive ? Theme.Size.lyricActive : Theme.Size.lyricIdle,
                      isActive ? .bold : .medium))
            .foregroundStyle(color)
            .lineLimit(1)
            // 长句缩字号而不换行：换行会让槽位高度失准，滚动就对不上了；
            // 而电视上一句一行本来也更好读。
            .minimumScaleFactor(0.46)
            .multilineTextAlignment(.center)
            .blur(radius: blur)
            .scaleEffect(isActive ? 1 : 0.97)
            .shadow(color: .black.opacity(isActive ? 0.6 : 0), radius: 22, y: 5)
            .animation(Theme.Motion.lyric, value: isActive)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    private var color: Color {
        if isActive { return Theme.lyricActive }
        switch magnitude {
        case 0, 1: return Theme.lyricNear
        case 2: return Color.white.opacity(0.28)
        case 3: return Color.white.opacity(0.20)
        default: return Theme.lyricFar
        }
    }

    private var blur: CGFloat {
        if isActive { return 0 }
        return min(CGFloat(magnitude) * 0.9, 3.6)
    }
}

/// 前奏卡片：制作名单 + 呼吸指示。
///
/// 前奏是这首歌唯一"没有内容可显示"的时段，正好用来交代它是谁做的 ——
/// 这些信息本来就在歌词文件里，只是不该跟着时间轴闪。
private struct IntroCard: View {
    let credits: [String]

    var body: some View {
        VStack(spacing: 30) {
            if !credits.isEmpty {
                VStack(spacing: 14) {
                    ForEach(credits, id: \.self) { credit in
                        creditRow(credit)
                    }
                }
                .padding(.horizontal, 54)
                .padding(.vertical, 38)
                .glassSurface(radius: Theme.radiusPanel, tint: 0.34)
            }
            BreathingDots()
        }
    }

    /// 名单排成「角色 — 人名」两列。
    ///
    /// 原样打印 `作词 : 小玉 林忠谕` 那种带冒号的原文，在大屏上像一行日志。
    /// 拆成两列之后角色右对齐、人名左对齐，才像一张演职员表。
    @ViewBuilder
    private func creditRow(_ credit: String) -> some View {
        if let separator = credit.firstIndex(where: { $0 == ":" || $0 == "：" }) {
            HStack(spacing: 20) {
                Text(credit[credit.startIndex..<separator].trimmingCharacters(in: .whitespaces))
                    .font(.tv(Theme.Size.caption, .regular))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 110, alignment: .trailing)
                Text(credit[credit.index(after: separator)...].trimmingCharacters(in: .whitespaces))
                    .font(.tv(Theme.Size.caption, .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 320, alignment: .leading)
            }
        } else {
            Text(credit)
                .font(.tv(Theme.Size.caption, .regular))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

/// 间奏指示。三个点按 1.4 秒一轮依次呼吸 —— 存在感刚够说明"还在放，
/// 只是这一段没有词"，又不至于变成一个抢眼的动画。
private struct BreathingDots: View {
    var body: some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate / 1.4
            HStack(spacing: 16) {
                ForEach(0..<3, id: \.self) { index in
                    let local = (phase - Double(index) * 0.22).truncatingRemainder(dividingBy: 1)
                    let wave = 0.35 + 0.65 * max(0, sin(local * .pi))
                    Circle()
                        .fill(Color.white.opacity(0.30 * wave + 0.10))
                        .frame(width: 14, height: 14)
                        .scaleEffect(0.8 + 0.35 * wave)
                }
            }
        }
        .frame(height: 20)
    }
}

// MARK: - 底部信息条

/// 底部信息条。玻璃面板 + 封面 + 细进度条。
///
/// 做成一块有边界的玻璃，而不是几行浮在背景上的字 —— 后者在颜色多变的
/// 模糊底图上时而看不清，而且没有"这是控制区"的层次感。
private struct TransportBar: View {
    let track: PlexItem
    let thumbURL: URL?
    let position: Double
    let duration: Double
    let isPlaying: Bool
    let controls: AnyView?

    var body: some View {
        VStack(spacing: 20) {
        HStack(spacing: 28) {
            ArtworkTile(url: thumbURL, fallback: track.displayTitle, side: 104, radius: 12)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(track.displayTitle)
                        .font(.tv(Theme.Size.title - 10, .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    if !isPlaying {
                        Label("已暂停", systemImage: "pause.fill")
                            .labelStyle(.titleAndIcon)
                            .font(.tv(19, .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    Spacer(minLength: 8)
                    // 音质角标：用户明确说过不喜欢转码播放，所以现在放的是什么
                    // 就该看得见。直连无损是这个应用的卖点之一。
                    QualityBadge(codec: track.audioCodec, bitrate: track.bitrate)
                }
                Text(subtitle)
                    .font(.tv(Theme.Size.caption, .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                ProgressLine(position: position, duration: duration)
            }
        }
        if let controls { controls }
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 22)
        .glassSurface(radius: Theme.radiusPanel, tint: 0.30)
    }

    private var subtitle: String {
        let album = track.displayAlbum
        return album.isEmpty ? track.displayArtist : "\(track.displayArtist) · \(album)"
    }
}

private struct QualityBadge: View {
    let codec: String?
    let bitrate: Int?

    var body: some View {
        if let codec {
            Text(label(codec))
                .font(.tv(19, .semibold))
                .foregroundStyle(isLossless(codec) ? Theme.lyricActive : Theme.textSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(Theme.surface))
                .overlay(Capsule().stroke(Theme.hairline, lineWidth: 1))
        }
    }

    private func isLossless(_ codec: String) -> Bool {
        ["flac", "alac", "pcm", "wav", "ape", "dsd"].contains(codec.lowercased())
    }

    private func label(_ codec: String) -> String {
        let name = codec.uppercased()
        if isLossless(codec) { return "\(name) 无损直连" }
        if let bitrate, bitrate > 0 { return "\(name) \(bitrate)k" }
        return name
    }
}

private struct ProgressLine: View {
    let position: Double
    let duration: Double

    var body: some View {
        HStack(spacing: 18) {
            Text(time(position))
            GeometryReader { geometry in
                let fraction = duration > 0 ? min(1, max(0, position / duration)) : 0
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.18))
                    Capsule()
                        .fill(LinearGradient(
                            colors: [Color.white.opacity(0.75), Color.white],
                            startPoint: .leading, endPoint: .trailing
                        ))
                        .frame(width: max(0, geometry.size.width * fraction))
                }
                .frame(height: 5)
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 14)
            Text(time(duration))
        }
        .font(.tv(20, .medium).monospacedDigit())
        .foregroundStyle(Theme.textSecondary)
    }

    private func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

// MARK: - 封面

/// 封面块。带一道自上而下的高光，让它看起来是一片有厚度的材质，
/// 而不是一张贴在背景上的图。
struct ArtworkTile: View {
    let url: URL?
    let fallback: String
    let side: CGFloat
    var radius: CGFloat = 18

    var body: some View {
        CoverImage(url: url, cornerRadius: radius, fallbackText: fallback)
            .frame(width: side, height: side)
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(LinearGradient(
                        colors: [Color.white.opacity(0.16), .clear],
                        startPoint: .top, endPoint: .center
                    ))
                    .blendMode(.plusLighter)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.5), radius: side * 0.14, y: side * 0.06)
    }
}

// MARK: - 走带控制

/// 走带控制条：随机 / 上一首 / 播放暂停 / 下一首 / 循环。
///
/// tvOS 上遥控器的播放键已经能控制播放（走 MPRemoteCommandCenter），但屏幕上
/// **必须**同时有这排按钮 —— 随机和循环没有对应的物理键，而且"看得见能做什么"
/// 本身就是界面的职责。Apple Music 的 tvOS 版也是这个排法。
struct TransportControls: View {
    @ObservedObject var player: MusicPlayer

    var body: some View {
        HStack(spacing: 26) {
            IconControl(
                system: "shuffle",
                active: player.shuffled,
                hint: player.shuffled ? "随机播放已开" : "随机播放"
            ) { player.toggleShuffle() }

            IconControl(system: "backward.fill", hint: "上一首") { player.previous() }

            IconControl(
                system: player.isBuffering ? "hourglass" : (player.isPlaying ? "pause.fill" : "play.fill"),
                large: true,
                hint: player.isPlaying ? "暂停" : "播放"
            ) { player.toggle() }

            IconControl(system: "forward.fill", hint: "下一首") { player.next() }

            IconControl(
                system: player.repeatMode.symbol,
                active: player.repeatMode != .off,
                hint: player.repeatMode.label
            ) { player.cycleRepeat() }

            Spacer(minLength: 20)

            if !player.upNext.isEmpty {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("下一首")
                        .font(.tv(17, .semibold))
                        .foregroundStyle(Theme.textTertiary)
                    Text(player.upNext[0].displayTitle)
                        .font(.tv(Theme.Size.cardSubtitle, .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: 320, alignment: .trailing)
            }
        }
    }
}

private struct IconControl: View {
    let system: String
    var active = false
    var large = false
    let hint: String
    let action: () -> Void

    var body: some View {
        // 「已开启」的状态（随机、循环）用 prominent，一眼能看出它是亮着的；
        // 其余用普通玻璃。这比自己涂两种背景色更贴合系统的观感。
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: large ? 32 : 25, weight: .bold))
                .frame(width: large ? 46 : 32, height: large ? 46 : 32)
        }
        .accessibilityLabel(hint)
        // 「已开启」（随机、循环）用 prominent，一眼看出它亮着。
        .glassButton(prominent: active, circular: true)
    }
}
