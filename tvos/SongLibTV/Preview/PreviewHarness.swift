#if DEBUG
import Foundation
import SwiftUI

/// 用真实素材离线渲染歌词页。
///
/// 存在的理由：调视觉需要真实内容 —— 真的中文歌词、真的封面、真的间奏和
/// 制作名单。拿假数据（"Lorem ipsum"、纯色方块）调出来的版式，一放上真东西
/// 就散架。而登录 Plex 需要用户的账号，不该为了改一次字号就去打扰人。
///
/// 素材是从库里那首《一万小时》原样导出来的，包括开头四行制作名单和
/// 10.09s→33.36s 那段空行间奏 —— 正是两个最容易做错的地方。
///
/// 只在 DEBUG 里编译，带 `-preview` 启动参数才生效。
enum PreviewFixture {
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains("-preview")
    }

    static let track = PlexItem(
        ratingKey: "preview", key: nil, type: "track",
        title: "一万小时", parentTitle: "一万小时", grandparentTitle: "宇宙人",
        parentRatingKey: nil, grandparentRatingKey: nil,
        thumb: nil, parentThumb: nil, grandparentThumb: nil, art: nil,
        duration: 301_558, index: 1, year: 2024, addedAt: nil,
        leafCount: nil, playlistType: nil,
        media: [PlexMedia(id: 1, audioCodec: "flac", audioChannels: 2,
                          bitrate: 1556, container: "flac", duration: 301_558,
                          parts: nil)]
    )

    static func lyrics() -> LyricsTimeline? {
        guard let url = Bundle.main.url(forResource: "preview-lyrics", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let payload = try? JSONDecoder().decode(PlexLyricsEnvelope.self, from: data),
              let found = payload.first,
              let lines = found.lines
        else { return nil }
        return LyricsTimeline(
            lines: lines.compactMap { line in
                guard let start = line.startOffset else { return nil }
                return LyricsTimeline.Line(
                    start: Double(start) / 1000.0,
                    end: line.endOffset.map { Double($0) / 1000.0 },
                    text: line.text.trimmingCharacters(in: .whitespaces)
                )
            },
            isTimed: found.timed ?? true
        )
    }

    static var coverURL: URL? {
        Bundle.main.url(forResource: "preview-cover", withExtension: "jpg")
    }
}

/// 离线歌词页：和真机走的是同一个 `LyricsScroller` 和同一套 Theme，
/// 只把"播放头"换成一个可以指定起点的假时钟。
struct PreviewNowPlaying: View {
    /// 从第几秒开始。调不同段落的视觉时改这个值：
    /// 5 秒看制作名单、20 秒看间奏、45 秒看正常滚动。
    let startSeconds: Double
    @State private var lyrics: LyricsTimeline?
    @State private var origin = Date()

    var body: some View {
        NowPlayingPreviewBody(
            track: PreviewFixture.track,
            lyrics: lyrics,
            coverURL: PreviewFixture.coverURL,
            position: { startSeconds + Date().timeIntervalSince(origin) }
        )
        .task {
            lyrics = PreviewFixture.lyrics()
            origin = Date()
        }
    }
}
#endif
