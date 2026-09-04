import SwiftUI

/// 浏览库：最近添加的专辑、播放列表、搜索。
struct BrowseView: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var albums: [PlexItem] = []
    @State private var playlists: [PlexItem] = []
    @State private var sectionKey: String?
    @State private var loading = true
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 54) {
                    header
                    if loading {
                        ProgressView().scaleEffect(1.5)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 80)
                    } else {
                        if let notice {
                            Text(notice)
                                .font(.system(size: 26))
                                .foregroundStyle(Theme.textTertiary)
                        }
                        row(title: "最近添加", items: albums)
                        row(title: "播放列表", items: playlists)
                    }
                }
                .padding(.horizontal, Theme.screenPadding)
                .padding(.vertical, 60)
            }
            .background(Theme.canvas.ignoresSafeArea())
        }
        .task { await load() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 8) {
                Text("SongLib")
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                if !state.serverName.isEmpty {
                    Text(state.serverName + (state.connection?.isLocal == true ? " · 局域网直连" : " · 远程"))
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            Spacer()
            if player.currentTrack != nil {
                NavigationLink {
                    NowPlayingView(player: player, library: state.library)
                } label: {
                    Text("正在播放")
                        .font(.system(size: 28, weight: .semibold))
                }
            }
        }
    }

    private func row(title: String, items: [PlexItem]) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(title)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            if items.isEmpty {
                Text("这里还没有内容")
                    .font(.system(size: 24))
                    .foregroundStyle(Theme.textTertiary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 34) {
                        ForEach(items) { item in
                            card(item)
                        }
                    }
                    .padding(.vertical, 24)
                    .padding(.horizontal, 6)
                }
            }
        }
    }

    private func card(_ item: PlexItem) -> some View {
        NavigationLink {
            AlbumView(item: item, state: state, player: player)
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                CoverImage(
                    url: state.library?.coverURL(for: item, size: 400),
                    fallbackText: item.displayTitle
                )
                .frame(width: 260, height: 260)
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.displayTitle)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(item.playlistType != nil
                         ? "\(item.leafCount ?? 0) 首"
                         : item.displayArtist)
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                }
                .frame(width: 260, alignment: .leading)
            }
        }
        .buttonStyle(.card)
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        do {
            let sections = try await library.musicSections()
            guard let first = sections.first else {
                notice = "这台服务器上没有音乐库"
                return
            }
            sectionKey = first.ratingKey
            albums = try await library.browse(section: first.ratingKey, type: .album, size: 30)
        } catch {
            notice = "读取音乐库失败：\(error.localizedDescription)"
        }
        // 播放列表单独接错误：实测这个库里有一批读不出来的僵尸列表，
        // 不能让它们把整页拖垮。
        playlists = (try? await library.playlists()) ?? []
    }
}

/// 专辑或播放列表的曲目清单。
struct AlbumView: View {
    let item: PlexItem
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    @State private var tracks: [PlexItem] = []
    @State private var loading = true
    @State private var failure: String?

    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()
            HStack(alignment: .top, spacing: 60) {
                VStack(alignment: .leading, spacing: 22) {
                    CoverImage(
                        url: state.library?.coverURL(for: item, size: 500),
                        cornerRadius: 20,
                        fallbackText: item.displayTitle
                    )
                    .frame(width: 380, height: 380)
                    .shadow(color: .black.opacity(0.5), radius: 30, y: 14)

                    Text(item.displayTitle)
                        .font(.system(size: 38, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(2)
                    if item.playlistType == nil {
                        Text(item.displayArtist)
                            .font(.system(size: 28))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    if !tracks.isEmpty {
                        Button {
                            player.play(tracks, startingAt: 0)
                        } label: {
                            Label("播放全部", systemImage: "play.fill")
                                .font(.system(size: 28, weight: .semibold))
                        }
                    }
                }
                .frame(width: 380)

                content
            }
            .padding(Theme.screenPadding)
        }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().scaleEffect(1.5).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let failure {
            VStack(alignment: .leading, spacing: 14) {
                Text("这个列表读不出来")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(failure)
                    .font(.system(size: 24))
                    .foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                        Button {
                            player.play(tracks, startingAt: index)
                        } label: {
                            HStack(spacing: 20) {
                                Text("\(index + 1)")
                                    .font(.system(size: 24, weight: .medium).monospacedDigit())
                                    .foregroundStyle(Theme.textTertiary)
                                    .frame(width: 54, alignment: .trailing)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(track.displayTitle)
                                        .font(.system(size: 28, weight: .medium))
                                        .lineLimit(1)
                                    Text(track.displayArtist)
                                        .font(.system(size: 22))
                                        .foregroundStyle(Theme.textTertiary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Text(duration(track.durationSeconds))
                                    .font(.system(size: 22).monospacedDigit())
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .padding(.vertical, 14)
                            .padding(.horizontal, 24)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func duration(_ seconds: Double) -> String {
        guard seconds > 0 else { return "" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    private func load() async {
        guard let library = state.library else { return }
        loading = true
        defer { loading = false }
        do {
            if item.playlistType != nil {
                tracks = try await library.playlistItems(item.ratingKey)
            } else {
                tracks = try await library.children(of: item.ratingKey)
            }
        } catch {
            failure = error.localizedDescription
        }
    }
}
