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
        .task { await load() }
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        do {
            guard let section = try await library.musicSections().first else {
                notice = "这台服务器上没有音乐库"; return
            }
            recentAlbums = try await library.browse(section: section.ratingKey, type: .album, size: 24)
            hero = recentAlbums.first
            artists = try await library.browse(section: section.ratingKey, type: .artist,
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
            // 背景用专辑的宽幅图，压暗到能压住白字。
            CoverImage(url: state.library?.coverURL(for: item, size: 900), cornerRadius: 0)
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
                    // 卡片获得焦点时会放大 8%，两侧和上下都得留出放大的余量，
                    // 不然放大的那张会被裁掉。
                    .padding(.horizontal, Theme.screenH)
                    .padding(.vertical, 26)
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

    private var side: CGFloat { 250 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CoverImage(
                url: state.library?.coverURL(for: item, size: 420),
                cornerRadius: circular ? side / 2 : Theme.radiusCard,
                fallbackText: item.displayTitle
            )
            .frame(width: side, height: side)
            .focusLift(focused, radius: circular ? side / 2 : Theme.radiusCard)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayTitle)
                    .font(.tv(Theme.Size.cardTitle, .semibold))
                    .foregroundStyle(Theme.textPrimary)
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
        .task { await load() }
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        if section == nil {
            section = try? await library.musicSections().first?.ratingKey
        }
        guard let section else { return }
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
            // 背景：模糊放大的封面，和歌词页同一套语言，切换过去不突兀。
            Theme.canvas.ignoresSafeArea()
            CoverImage(url: state.library?.coverURL(for: item, size: 720), cornerRadius: 0)
                .scaleEffect(1.4)
                .blur(radius: 130, opaque: true)
                .opacity(0.42)
                .ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0.82)],
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
            TrackTable(tracks: tracks, player: player, state: state, showArtist: item.playlistType != nil)
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

    var body: some View {
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
