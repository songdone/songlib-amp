import SwiftUI

/// 应用主结构，照 Apple Music 的 tvOS 版来：顶部一排标签，内容在下面。
///
/// tvOS 上不用侧边栏 —— 遥控器是方向键，横向标签在顶部时"上到顶再按上"
/// 就能切换，这是这个平台的肌肉记忆。
struct LibraryView: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    var body: some View {
        TabView {
            HomeTab(state: state, player: player)
                .tabItem { Text("资料库") }
            BrowseTab(state: state, player: player)
                .tabItem { Text("浏览") }
            SearchTab(state: state, player: player)
                .tabItem { Text("搜索") }
            NowPlayingTab(state: state, player: player)
                .tabItem { Text("正在播放") }
            SettingsTab(state: state, player: player)
                .tabItem { Text("设置") }
        }
        .background(Theme.canvas.ignoresSafeArea())
    }
}

// MARK: - 资料库

private struct HomeTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var recentAlbums: [PlexItem] = []
    @State private var playlists: [PlexItem] = []
    @State private var artists: [PlexItem] = []
    @State private var hero: PlexItem?
    @State private var loading = true
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.shelfGap) {
                    // 头部在最顶上。
                    //
                    // 之前插在 hero 和第一排货架之间，结果标题和资料库选择器
                    // 出现在大图**下面**，货架被挤出屏幕 —— 截图上一眼就是错的。
                    LibraryHeader(state: state)
                    if let hero {
                        HeroBanner(item: hero, state: state, player: player)
                            .padding(.bottom, 8)
                    }
                    if loading {
                        ProgressView().scaleEffect(1.5)
                            .frame(maxWidth: .infinity).padding(.vertical, 100)
                    }
                    if let notice {
                        Text(notice).font(.tv(Theme.Size.caption))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.horizontal, Theme.screenH)
                    }
                    Shelf(title: "最近添加", items: recentAlbums, state: state, player: player)
                    Shelf(title: "播放列表", items: playlists, state: state, player: player)
                    Shelf(title: "艺人", items: artists, state: state, player: player, circular: true)
                }
                .padding(.vertical, 40)
            }
            .background(Theme.canvas.ignoresSafeArea())
        }
        .task(id: state.sectionKey) { await load() }
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        // 每次重新载入都要先清掉上一次的提示。
        //
        // 之前没清：首次 load 跑在 sectionKey 还没到位的时候，设了
        // "这台服务器上没有音乐库"；等库到位、内容加载出来之后，这条提示
        // 还挂在屏幕上跟 hero 并排显示，自相矛盾。
        notice = nil
        defer { loading = false }
        do {
            guard let key = state.sectionKey else {
                // 库列表还在路上时不报错 —— 只有确定一个音乐库都没有才报。
                if !state.sections.isEmpty { notice = "这台服务器上没有音乐库" }
                return
            }
            recentAlbums = try await library.browse(section: key, type: .album, size: 24)
            hero = recentAlbums.first
            artists = try await library.browse(section: key, type: .artist,
                                               sort: "addedAt:desc", size: 20)
        } catch {
            notice = "读取音乐库失败：\(error.localizedDescription)"
        }
        // 播放列表单独接错误：实测这个库里有一批读不出内容的僵尸列表，
        // 不能让它们把整页拖垮。
        playlists = (try? await library.playlists()) ?? []
    }
}

/// 首屏顶部的大图。
///
/// Apple Music 和几乎所有大屏应用都有这一块 —— 它的作用不是好看，是给
/// 「现在能干什么」一个不用思考的入口：一进来焦点就落在「播放」上。
private struct HeroBanner: View {
    let item: PlexItem
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @FocusState private var focus: Field?
    @State private var tracks: [PlexItem] = []
    private enum Field { case play, shuffle, open }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // 背景：把方形封面放大模糊当底，不硬裁成宽幅。
            //
            // 之前是把 1:1 的封面直接拉成 16:5 再裁 —— 裁出来是一张怪异的
            // 局部特写（截图上是半张脸）。Plex 的曲目/专辑大多没有宽幅背景图，
            // 所以正确做法是模糊放大：既填满画面，又不会裁到奇怪的地方。
            Group {
                if let backdrop = state.library?.backdropURL(for: item) {
                    CoverImage(url: backdrop, cornerRadius: 0)
                        .saturation(1.08)
                } else {
                    CoverImage(url: state.library?.coverURL(for: item, size: 900), cornerRadius: 0)
                        .scaleEffect(1.6)
                        .blur(radius: 90, opaque: true)
                        .saturation(1.15)
                }
            }
            .frame(height: 560)
            .clipped()
                .overlay(
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.10), location: 0),
                            .init(color: .black.opacity(0.72), location: 0.55),
                            .init(color: Theme.canvas.opacity(0.98), location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )

            HStack(alignment: .bottom, spacing: 40) {
                ArtworkTile(url: state.library?.coverURL(for: item, size: 500),
                            fallback: item.displayTitle, side: 240, radius: 16)

                VStack(alignment: .leading, spacing: 16) {
                    Text("最新加入")
                        .font(.tv(20, .semibold))
                        .foregroundStyle(Theme.textTertiary)
                        .tracking(2)
                    Text(item.displayTitle)
                        .font(.tv(Theme.Size.title, .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(item.displayArtist)
                        .font(.tv(Theme.Size.body))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)

                    HStack(spacing: 18) {
                        PillButton(title: "播放", icon: "play.fill", prominent: true) {
                            Task { await start(shuffle: false) }
                        }
                        .focused($focus, equals: .play)

                        PillButton(title: "随机播放", icon: "shuffle") {
                            Task { await start(shuffle: true) }
                        }
                        .focused($focus, equals: .shuffle)

                        NavigationLink {
                            DetailView(item: item, state: state, player: player)
                        } label: {
                            PillLabel(title: "查看专辑", icon: "list.bullet")
                        }
                        .glassButton()
                        .focused($focus, equals: .open)
                    }
                    .padding(.top, 8)
                    .focusSection()
                }
                Spacer()
            }
            .padding(.horizontal, Theme.screenH)
            .padding(.bottom, 36)
        }
        .frame(height: 560)
        .onAppear { focus = .play }
    }

    private func start(shuffle: Bool) async {
        guard let library = state.library else { return }
        if tracks.isEmpty {
            tracks = (try? await library.children(of: item.ratingKey)) ?? []
        }
        guard !tracks.isEmpty else { return }
        player.play(tracks, startingAt: 0, shuffle: shuffle)
    }
}

/// 一条横向货架。
private struct Shelf: View {
    let title: String
    let items: [PlexItem]
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer
    var circular = false

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 20) {
                Text(title)
                    .font(.tv(Theme.Size.sectionHeader, .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, Theme.screenH)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: Theme.cardGap) {
                        ForEach(items) { item in
                            NavigationLink {
                                DetailView(item: item, state: state, player: player)
                            } label: {
                                MediaCard(item: item, state: state, circular: circular)
                            }
                            .buttonStyle(.card)
                        }
                    }
                    // 卡片获得焦点时会放大，两侧和上下都得留出放大的余量，
                    // 不然放大的那张会被裁掉。
                    .padding(.horizontal, Theme.screenH)
                    .padding(.vertical, 26)
                    // 每条货架各自成一个焦点分区：上下键在货架之间跳，
                    // 不会因为横向位置不对就跳不过去（也不会跳错货架）。
                    .focusSection()
                }
            }
        }
    }
}

private struct MediaCard: View {
    let item: PlexItem
    @ObservedObject var state: AppState
    var circular = false
    @Environment(\.isFocused) private var focused

    /// 卡片边长。Apple Music 的 tvOS 版在 1080p 上大约 320pt —— 250 太小，
    /// 一屏塞进七八张，看着像网页而不像大屏应用。
    private var side: CGFloat { 320 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CoverImage(
                url: state.library?.coverURL(for: item, size: 420),
                cornerRadius: circular ? side / 2 : Theme.radiusCard,
                fallbackText: item.displayTitle
            )
            .frame(width: side, height: side)
            .posterSurface(focused, radius: circular ? side / 2 : Theme.radiusCard)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayTitle)
                    .font(.tv(Theme.Size.cardTitle, .semibold))
                    .foregroundStyle(focused ? Theme.textPrimary : Theme.textSecondary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.tv(Theme.Size.cardSubtitle))
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            .frame(width: side, alignment: circular ? .center : .leading)
        }
    }

    private var subtitle: String {
        if item.playlistType != nil { return "\(item.leafCount ?? 0) 首" }
        if item.type == "artist" { return "艺人" }
        return item.displayArtist
    }
}

// MARK: - 浏览（按专辑 / 艺人 全量翻）

private struct BrowseTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var mode: Mode = .album
    @State private var items: [PlexItem] = []
    @State private var section: String?
    @State private var loading = false

    enum Mode: String, CaseIterable {
        case album = "专辑", artist = "艺人", track = "歌曲"
        var type: PlexLibrary.ItemType {
            switch self {
            case .album: return .album
            case .artist: return .artist
            case .track: return .track
            }
        }
    }

    private let columns = [GridItem(.adaptive(minimum: 250, maximum: 300), spacing: Theme.cardGap)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(spacing: 16) {
                        ForEach(Mode.allCases, id: \.self) { candidate in
                            SegmentButton(title: candidate.rawValue, selected: mode == candidate) {
                                mode = candidate
                                Task { await load() }
                            }
                        }
                    }
                    .padding(.horizontal, Theme.screenH)
                    .focusSection()

                    if loading {
                        ProgressView().scaleEffect(1.4)
                            .frame(maxWidth: .infinity).padding(.vertical, 80)
                    } else if mode == .track {
                        TrackTable(tracks: items, player: player, state: state)
                            .padding(.horizontal, Theme.screenH)
                    } else {
                        LazyVGrid(columns: columns, spacing: 40) {
                            ForEach(items) { item in
                                NavigationLink {
                                    DetailView(item: item, state: state, player: player)
                                } label: {
                                    MediaCard(item: item, state: state, circular: mode == .artist)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, Theme.screenH)
                        .padding(.vertical, 20)
                    }
                }
                .padding(.vertical, 40)
            }
            .background(Theme.canvas.ignoresSafeArea())
        }
        .task(id: state.sectionKey) { await load() }
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        guard let section = state.sectionKey else { return }
        items = (try? await library.browse(section: section, type: mode.type,
                                           sort: "titleSort:asc", size: 120)) ?? []
    }
}

// MARK: - 搜索

private struct SearchTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var text = ""
    @State private var tracks: [PlexItem] = []
    @State private var albums: [PlexItem] = []
    @State private var artists: [PlexItem] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 34) {
                    if searching {
                        ProgressView().scaleEffect(1.3)
                            .frame(maxWidth: .infinity).padding(.vertical, 40)
                    }
                    if !albums.isEmpty {
                        Shelf(title: "专辑", items: albums, state: state, player: player)
                    }
                    if !artists.isEmpty {
                        Shelf(title: "艺人", items: artists, state: state, player: player, circular: true)
                    }
                    if !tracks.isEmpty {
                        VStack(alignment: .leading, spacing: 18) {
                            Text("歌曲")
                                .font(.tv(Theme.Size.sectionHeader, .semibold))
                                .foregroundStyle(Theme.textPrimary)
                            TrackTable(tracks: tracks, player: player, state: state)
                        }
                        .padding(.horizontal, Theme.screenH)
                    }
                    if !text.isEmpty, !searching, tracks.isEmpty, albums.isEmpty, artists.isEmpty {
                        Text("没有找到「\(text)」")
                            .font(.tv(Theme.Size.body))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.horizontal, Theme.screenH)
                    }
                }
                .padding(.vertical, 30)
            }
            .background(Theme.canvas.ignoresSafeArea())
            .searchable(text: $text, prompt: "搜索歌曲、专辑、艺人")
            .onSubmit(of: .search) { Task { await run() } }
        }
    }

    private func run() async {
        guard let library = state.library else { return }
        searching = true
        defer { searching = false }
        let found = try? await library.search(text)
        tracks = found?.tracks ?? []
        albums = found?.albums ?? []
        artists = found?.artists ?? []
    }
}

// MARK: - 详情（专辑 / 播放列表 / 艺人）

struct DetailView: View {
    let item: PlexItem
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var tracks: [PlexItem] = []
    @State private var albums: [PlexItem] = []
    @State private var loading = true
    @State private var failure: String?
    @FocusState private var focusPlay: Bool

    private var isArtist: Bool { item.type == "artist" }

    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()

            // 背景优先用 Plex 存的**宽幅背景图**（art），它是专门为 16:9 画面
            // 准备的一张图，和方形封面是两回事。艺人页尤其明显：有 art 的时候
            // 是一张真正的艺人大片，没有的时候只能拿方形封面模糊顶上。
            if let backdrop = state.library?.backdropURL(for: item) {
                CoverImage(url: backdrop, cornerRadius: 0)
                    .scaleEffect(1.06)
                    .blur(radius: 18, opaque: true)
                    .opacity(0.62)
                    .ignoresSafeArea()
            } else {
                CoverImage(url: state.library?.coverURL(for: item, size: 720), cornerRadius: 0)
                    .scaleEffect(1.4)
                    .blur(radius: 130, opaque: true)
                    .opacity(0.42)
                    .ignoresSafeArea()
            }
            // 压暗：左边重（内容在左侧），下面重（要压住文字）。
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.86), location: 0.00),
                    .init(color: .black.opacity(0.58), location: 0.42),
                    .init(color: .black.opacity(0.34), location: 1.00),
                ],
                startPoint: .leading, endPoint: .trailing
            )
            .ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.20), .black.opacity(0.72)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            ScrollView {
                HStack(alignment: .top, spacing: 56) {
                    sidebar
                        .frame(width: 400)
                    content
                }
                .padding(.horizontal, Theme.screenH)
                .padding(.vertical, Theme.screenV)
            }
        }
        .task { await load() }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 22) {
            ArtworkTile(url: state.library?.coverURL(for: item, size: 600),
                        fallback: item.displayTitle,
                        side: 400, radius: isArtist ? 200 : 20)

            Text(item.displayTitle)
                .font(.tv(Theme.Size.title - 4, .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)

            if !isArtist {
                Text(item.playlistType != nil
                     ? "\(tracks.count) 首歌曲"
                     : item.displayArtist)
                    .font(.tv(Theme.Size.body))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            if !isArtist, totalMinutes > 0 {
                Text("约 \(totalMinutes) 分钟")
                    .font(.tv(Theme.Size.caption))
                    .foregroundStyle(Theme.textTertiary)
            }

            if !tracks.isEmpty {
                VStack(spacing: 14) {
                    PillButton(title: "播放", icon: "play.fill", prominent: true, fill: true) {
                        player.play(tracks, startingAt: 0)
                    }
                    .focused($focusPlay)
                    PillButton(title: "随机播放", icon: "shuffle", fill: true) {
                        player.play(tracks, startingAt: 0, shuffle: true)
                    }
                    PillButton(title: "加入待播", icon: "text.append", fill: true) {
                        player.append(tracks)
                    }
                }
                .padding(.top, 10)
                .focusSection()
            }
        }
        .onChange(of: tracks.count) { _, count in if count > 0 { focusPlay = true } }
    }

    private var totalMinutes: Int {
        Int(tracks.reduce(0) { $0 + $1.durationSeconds } / 60)
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().scaleEffect(1.4).frame(maxWidth: .infinity, minHeight: 400)
        } else if let failure {
            VStack(alignment: .leading, spacing: 12) {
                Text("这个列表读不出来")
                    .font(.tv(Theme.Size.sectionHeader, .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(failure)
                    .font(.tv(Theme.Size.caption))
                    .foregroundStyle(Theme.textTertiary)
                // 实测这个库里 23 个音频播放列表有 13 个取内容返回 500 ——
                // 都是标题重复的僵尸记录。说清楚比只给个错误码有用。
                Text("Plex 服务器读取这个列表时报错了。这通常是库里的残留记录，不是网络问题。")
                    .font(.tv(Theme.Size.caption))
                    .foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if isArtist {
            VStack(alignment: .leading, spacing: 20) {
                Text("专辑")
                    .font(.tv(Theme.Size.sectionHeader, .semibold))
                    .foregroundStyle(Theme.textPrimary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230, maximum: 280), spacing: 30)],
                          spacing: 34) {
                    ForEach(albums) { album in
                        NavigationLink {
                            DetailView(item: album, state: state, player: player)
                        } label: {
                            MediaCard(item: album, state: state)
                        }
                        .buttonStyle(.card)
                    }
                }
            }
        } else {
            // 曲目表自成分区：从左边的「播放」按钮按右键能直接进来，
            // 不用先竖着找到某一行的高度。
            TrackTable(tracks: tracks, player: player, state: state, showArtist: item.playlistType != nil)
                .focusSection()
        }
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        do {
            if isArtist {
                albums = try await library.children(of: item.ratingKey)
                // 艺人页也要能一键播 —— 把所有专辑的曲目串起来。
                var all: [PlexItem] = []
                for album in albums.prefix(8) {
                    all.append(contentsOf: (try? await library.children(of: album.ratingKey)) ?? [])
                }
                tracks = all
            } else if item.playlistType != nil {
                tracks = try await library.playlistItems(item.ratingKey)
            } else {
                tracks = try await library.children(of: item.ratingKey)
            }
        } catch {
            failure = error.localizedDescription
        }
    }
}

// MARK: - 曲目表

struct TrackTable: View {
    let tracks: [PlexItem]
    @ObservedObject var player: MusicPlayer
    @ObservedObject var state: AppState
    var showArtist = false

    var body: some View {
        LazyVStack(spacing: 8) {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { position, track in
                TrackRow(
                    number: position + 1,
                    track: track,
                    showArtist: showArtist,
                    isCurrent: player.currentTrack?.ratingKey == track.ratingKey,
                    isPlaying: player.isPlaying,
                    onPlay: { player.play(tracks, startingAt: position) },
                    onPlayNext: { player.playNext(track) }
                )
            }
        }
    }
}

private struct TrackRow: View {
    let number: Int
    let track: PlexItem
    let showArtist: Bool
    let isCurrent: Bool
    let isPlaying: Bool
    let onPlay: () -> Void
    let onPlayNext: () -> Void

    @Environment(\.isFocused) private var focusedEnv
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: onPlay) {
            HStack(spacing: 22) {
                // 当前这首用跳动的条替掉序号 —— 一眼能看出播到哪了。
                ZStack {
                    if isCurrent {
                        PlayingBars(animating: isPlaying)
                    } else {
                        Text("\(number)")
                            .font(.tv(Theme.Size.cardSubtitle, .medium).monospacedDigit())
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .frame(width: 46)

                VStack(alignment: .leading, spacing: 3) {
                    Text(track.displayTitle)
                        .font(.tv(Theme.Size.body - 2, isCurrent ? .semibold : .medium))
                        .foregroundStyle(isCurrent ? Theme.lyricActive : Theme.textPrimary)
                        .lineLimit(1)
                    if showArtist {
                        Text(track.displayArtist)
                            .font(.tv(Theme.Size.cardSubtitle))
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 16)

                if let codec = track.audioCodec, isLossless(codec) {
                    Text(codec.uppercased())
                        .font(.tv(17, .semibold))
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.surface))
                }

                Text(time(track.durationSeconds))
                    .font(.tv(Theme.Size.cardSubtitle).monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(focused ? Color.white.opacity(0.16) : (isCurrent ? Theme.surface : .clear))
            )
            .scaleEffect(focused ? 1.015 : 1)
            .animation(Theme.Motion.focus, value: focused)
        }
        .buttonStyle(.plain)
        .focused($focused)
        // 长按（遥控器上是"选择键"长按）给二级动作 —— Apple Music 也是这样。
        .contextMenu {
            Button { onPlay() } label: { Label("播放", systemImage: "play.fill") }
            Button { onPlayNext() } label: { Label("下一首播放", systemImage: "text.insert") }
        }
    }

    private func isLossless(_ codec: String) -> Bool {
        ["flac", "alac", "pcm", "wav", "ape", "dsd"].contains(codec.lowercased())
    }

    private func time(_ seconds: Double) -> String {
        guard seconds > 0 else { return "--:--" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

/// 正在播放的那首用三根跳动的条标出来。
struct PlayingBars: View {
    let animating: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { timeline in
            let phase = animating ? timeline.date.timeIntervalSinceReferenceDate * 3.2 : 0
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    let wave = animating
                        ? 0.35 + 0.65 * abs(sin(phase + Double(index) * 0.9))
                        : 0.45
                    Capsule()
                        .fill(Theme.lyricActive)
                        .frame(width: 5, height: 10 + 20 * wave)
                }
            }
            .frame(height: 32)
        }
    }
}

// MARK: - 通用控件

/// 药丸按钮。用 tvOS 26 的系统液态玻璃样式。
///
/// 自己画背景和焦点高光是下策 —— 系统的 `.glass` / `.glassProminent` 自带
/// 折射、焦点时的高光流动和按下的形变，那些手写不出来。所以这里只负责
/// 内容和排版，外观交给系统。
struct PillButton: View {
    let title: String
    let icon: String
    var prominent = false
    var fill = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            PillLabel(title: title, icon: icon, fill: fill)
        }
        .glassButton(prominent: prominent)
    }
}

struct PillLabel: View {
    let title: String
    let icon: String
    var fill = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.tv(Theme.Size.caption, .bold))
            Text(title)
                .font(.tv(Theme.Size.caption + 2, .semibold))
        }
        .frame(maxWidth: fill ? .infinity : nil)
        .padding(.vertical, 6)
    }
}

struct SegmentButton: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.tv(Theme.Size.caption + 2, .semibold))
                .padding(.vertical, 4)
        }
        .glassButton(prominent: selected)
    }
}

// MARK: - 正在播放标签

private struct NowPlayingTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    // 必须包一层 NavigationStack。
    //
    // 用户报「返回不是回应用上一级，有时直接回系统主桌面」—— 根因就在这里：
    // tvOS 的 Menu 键在**没有可返回的导航层级**时的行为就是退出应用。这个
    // 标签页原来是裸的一个视图，从它进全屏歌词之后按返回，系统找不到可以
    // 弹出的层级，于是直接退到桌面。
    var body: some View {
        NavigationStack { content }
    }

    @ViewBuilder
    private var content: some View {
        if player.currentTrack == nil {
            ZStack {
                Theme.canvas.ignoresSafeArea()
                VStack(spacing: 18) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 80))
                        .foregroundStyle(Theme.textTertiary)
                    Text("还没有在播放的内容")
                        .font(.tv(Theme.Size.body, .semibold))
                        .foregroundStyle(Theme.textSecondary)
                    Text("去「资料库」里选一张专辑或播放列表")
                        .font(.tv(Theme.Size.caption))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
        } else {
            NowPlayingView(player: player, library: state.library)
        }
    }
}


// MARK: - 资料库切换

/// 资料库选择器。
///
/// 用户明确指出这是缺的：Plexamp 连上 Plex 之后就是让你挑资料库的。
/// 实测这台服务器上有 14 个库，音乐库也可能不止一个（分类库、精选库、
/// 有声书库都常见），默认拿第一个是错的。
private struct LibraryHeader: View {
    @ObservedObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text(state.sectionTitle)
                    .font(.tv(Theme.Size.title, .bold))
                    .foregroundStyle(Theme.textPrimary)
                if !state.serverName.isEmpty {
                    Text(state.serverName
                         + (state.connection?.isLocal == true ? " · 局域网直连" : " · 远程直连"))
                        .font(.tv(Theme.Size.cardSubtitle))
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            // 只有一个音乐库时不显示切换器 —— 空有其表的下拉框比没有更糟。
            if state.sections.count > 1 {
                HStack(spacing: 14) {
                    ForEach(state.sections) { section in
                        SegmentButton(
                            title: section.displayTitle,
                            selected: section.ratingKey == state.sectionKey
                        ) { state.select(section: section) }
                    }
                }
                // 关键的一行。
                //
                // tvOS 的焦点移动是**几何**的：按上键时系统在正上方找最近的可
                // 聚焦元素。选择器原来甩在右上角，用户从左边的卡片按上，那个
                // 方向上什么都没有，于是根本到不了 —— 必须先横着走到和它对齐
                // 的位置。这就是用户报的"必须对齐它的位置上滑才能选中"。
                //
                // `focusSection()` 把这一排声明成一个焦点分区，焦点就按分区
                // 跳转而不是严格按几何位置：从下面任何一张卡片按上都能进来。
                //
                // 版式也一并改了：选择器现在和内容左对齐、直接压在第一排卡片
                // 上方，几何关系本身就顺了 —— 分区是保险，不是遮羞布。
                .focusSection()
            }
        }
        .padding(.horizontal, Theme.screenH)
        .padding(.top, 6)
    }
}


// MARK: - 设置

/// 设置页。
///
/// 用户明确指出缺这个。电视上的设置不该做成一长串开关 —— 遥控器上翻一屏
/// 开关是苦差事。所以只放真正需要选的几项，每项都用大按钮，一眼能看清
/// 当前值。
private struct SettingsTab: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer
    @ObservedObject private var cache = OfflineCache.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 46) {
                    Text("设置")
                        .font(.tv(Theme.Size.title, .bold))
                        .foregroundStyle(Theme.textPrimary)

                    if state.sections.count > 1 {
                        SettingsBlock(title: "音乐资料库",
                                      detail: "当前：\(state.sectionTitle)") {
                            HStack(spacing: 14) {
                                ForEach(state.sections) { section in
                                    SegmentButton(title: section.displayTitle,
                                                  selected: section.ratingKey == state.sectionKey) {
                                        state.select(section: section)
                                    }
                                }
                            }
                            .focusSection()
                        }
                    }

                    SettingsBlock(
                        title: "离线缓存",
                        detail: "已用 \(cache.usedDescription) / 上限 \(cache.limitDescription)"
                    ) {
                        HStack(spacing: 14) {
                            ForEach(OfflineCache.Limit.allCases, id: \.self) { limit in
                                SegmentButton(title: limit.label, selected: cache.limit == limit) {
                                    cache.setLimit(limit)
                                }
                            }
                        }
                        .focusSection()
                    }

                    SettingsBlock(title: "缓存内容", detail: "\(cache.trackCount) 首已下载到这台 Apple TV") {
                        PillButton(title: "清空缓存", icon: "trash") { cache.clear() }
                    }

                    SettingsBlock(title: "服务器", detail: state.serverName
                                  + (state.connection?.isLocal == true ? " · 局域网直连" : " · 远程直连")) {
                        PillButton(title: "退出登录", icon: "rectangle.portrait.and.arrow.right") {
                            player.stop()
                            state.signOutAndForget()
                        }
                    }
                }
                .padding(.horizontal, Theme.screenH)
                .padding(.vertical, Theme.screenV)
            }
            .background(Theme.canvas.ignoresSafeArea())
        }
    }
}

private struct SettingsBlock<Content: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.tv(Theme.Size.sectionHeader, .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(detail)
                    .font(.tv(Theme.Size.cardSubtitle))
                    .foregroundStyle(Theme.textTertiary)
            }
            content
        }
    }
}
