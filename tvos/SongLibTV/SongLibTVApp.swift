import SwiftUI

@main
struct SongLibTVApp: App {
    @StateObject private var state = AppState()
    @StateObject private var player = MusicPlayer()

    var body: some Scene {
        WindowGroup {
            RootView(state: state, player: player)
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @ObservedObject var state: AppState
    @ObservedObject var player: MusicPlayer

    var body: some View {
        Group {
#if DEBUG
            // 带 -preview 启动时直接进歌词页，用真实素材离线渲染。
            // 调视觉不该需要先登录一次 Plex。
            if PreviewFixture.isActive {
                PreviewNowPlaying(startSeconds: previewStart)
            } else {
                phaseView
            }
#else
            phaseView
#endif
        }
        .task { state.boot() }
        .onChange(of: state.connection) { _, connection in
            if let connection {
                player.attach(library: PlexLibrary(connection: connection))
            }
        }
    }

#if DEBUG
    /// 用 -previewAt <秒> 指定从哪一段开始看，默认 45 秒（正常滚动那一段）。
    private var previewStart: Double {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-previewAt"),
              index + 1 < args.count,
              let value = Double(args[index + 1]) else { return 45 }
        return value
    }
#endif

    private var phaseView: some View {
        Group {
            switch state.phase {
            case .checking:
                splash("正在启动…")
            case .signedOut:
                SignInView(state: state)
            case .connecting:
                splash("正在连接你的 Plex 服务器…")
            case .ready:
                LibraryView(state: state, player: player)
            }
        }
    }

    private func splash(_ text: String) -> some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()
            VStack(spacing: 26) {
                Text("SongLib Amp")
                    .font(.tv(60, .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(text)
                    .font(.tv(28, .medium))
                    .foregroundStyle(Theme.textSecondary)
                ProgressView().scaleEffect(1.4)
            }
        }
    }
}
