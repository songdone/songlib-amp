import Foundation

// MARK: - 通用容器

/// Plex 的 JSON 一律裹在 `MediaContainer` 里，列表放在 `Metadata`。
struct PlexEnvelope<Item: Decodable>: Decodable {
    let container: Container

    struct Container: Decodable {
        let size: Int?
        let totalSize: Int?
        let items: [Item]?

        enum CodingKeys: String, CodingKey {
            case size, totalSize
            case items = "Metadata"
        }
    }

    enum CodingKeys: String, CodingKey {
        case container = "MediaContainer"
    }

    var items: [Item] { container.items ?? [] }
    /// 分页要用总数，而 Plex 只在带了 Container-Start 时才给 totalSize。
    var total: Int { container.totalSize ?? container.size ?? 0 }
}

struct PlexIdentity: Decodable {
    let container: Container
    struct Container: Decodable {
        let machineIdentifier: String?
        let version: String?
    }
    enum CodingKeys: String, CodingKey { case container = "MediaContainer" }
}

// MARK: - 曲目 / 专辑 / 艺人

/// 一条媒体条目。专辑、艺人、曲目、播放列表在 Plex 里是同一张表的不同 `type`，
/// 字段能不能取到全看 type，所以除了 ratingKey 之外几乎全是可选的。
struct PlexItem: Decodable, Identifiable, Hashable {
    let ratingKey: String
    let key: String?
    let type: String?
    let title: String?
    let parentTitle: String?
    let grandparentTitle: String?
    let parentRatingKey: String?
    let grandparentRatingKey: String?
    let thumb: String?
    let parentThumb: String?
    let grandparentThumb: String?
    let art: String?
    let duration: Int?
    let index: Int?
    let year: Int?
    let addedAt: Int?
    let leafCount: Int?
    let playlistType: String?
    let media: [PlexMedia]?

    enum CodingKeys: String, CodingKey {
        case ratingKey, key, type, title, parentTitle, grandparentTitle
        case parentRatingKey, grandparentRatingKey
        case thumb, parentThumb, grandparentThumb, art
        case duration, index, year, addedAt, leafCount, playlistType
        case media = "Media"
    }

    var id: String { ratingKey }

    var displayTitle: String { title ?? "未命名" }

    /// 曲目的歌手在 `grandparentTitle`（专辑在 parentTitle）；专辑的歌手在
    /// `parentTitle`。取错一层的后果是满屏显示专辑名当歌手名。
    var displayArtist: String {
        if type == "track" { return grandparentTitle ?? parentTitle ?? "未知歌手" }
        return parentTitle ?? "未知歌手"
    }

    var displayAlbum: String {
        if type == "track" { return parentTitle ?? "" }
        return title ?? ""
    }

    /// 封面要一层层往上找。
    ///
    /// **曲目条目经常根本没有 `thumb`** —— 实测这个库里的曲目只有 `art` 和
    /// `grandparentThumb`。第一版直接读 `thumb` 在这里就崩了。
    var coverPath: String? {
        thumb ?? parentThumb ?? grandparentThumb
    }

    var durationSeconds: Double {
        Double(duration ?? 0) / 1000.0
    }

    /// 直连播放地址用的那个 Part。转码是最后的退路，不是默认。
    var firstPart: PlexPart? {
        media?.first?.parts?.first
    }

    var audioCodec: String? { media?.first?.audioCodec }
    var bitrate: Int? { media?.first?.bitrate }
}

struct PlexMedia: Decodable, Hashable {
    let id: Int?
    let audioCodec: String?
    let audioChannels: Int?
    let bitrate: Int?
    let container: String?
    let duration: Int?
    let parts: [PlexPart]?

    enum CodingKeys: String, CodingKey {
        case id, audioCodec, audioChannels, bitrate, container, duration
        case parts = "Part"
    }
}

struct PlexPart: Decodable, Hashable {
    let id: Int?
    let key: String?
    let container: String?
    let size: Int?
    let duration: Int?
    let streams: [PlexStream]?

    enum CodingKeys: String, CodingKey {
        case id, key, container, size, duration
        case streams = "Stream"
    }
}

struct PlexStream: Decodable, Hashable {
    let id: Int?
    let streamType: Int?
    let codec: String?
    let format: String?
    let key: String?

    /// Plex 的流类型：1 视频、2 音频、3 字幕、**4 歌词**。
    var isLyrics: Bool { streamType == 4 }
}

// MARK: - 搜索

/// `/hubs/search` 不返回平铺列表，而是按类别分成若干 Hub。
struct PlexSearchEnvelope: Decodable {
    let container: Container
    struct Container: Decodable {
        let hubs: [Hub]?
        enum CodingKeys: String, CodingKey { case hubs = "Hub" }
    }
    struct Hub: Decodable {
        let type: String?
        let title: String?
        let items: [PlexItem]?
        enum CodingKeys: String, CodingKey {
            case type, title
            case items = "Metadata"
        }
    }
    enum CodingKeys: String, CodingKey { case container = "MediaContainer" }

    func items(ofType type: String) -> [PlexItem] {
        (container.hubs ?? []).first { $0.type == type }?.items ?? []
    }
}

// MARK: - 歌词

/// Plex 带 `Accept: application/json` 时会把歌词返回成结构化的时间轴，
/// 而不是一段 LRC 文本 —— 每行都带**起止**毫秒。
///
/// 有结束时间这件事比看上去重要：靠它才能分出"这行唱完了"和"下一行还没到"，
/// 也就是间奏。只有起始时间的话，一段 23 秒的前奏会表现成第一句歌词在屏幕上
/// 干挂 23 秒。
struct PlexLyricsEnvelope: Decodable {
    let container: Container
    struct Container: Decodable {
        let lyrics: [Lyrics]?
        enum CodingKeys: String, CodingKey { case lyrics = "Lyrics" }
    }
    struct Lyrics: Decodable {
        let provider: String?
        let timed: Bool?
        let lines: [Line]?
        enum CodingKeys: String, CodingKey {
            case provider, timed
            case lines = "Line"
        }
    }
    struct Line: Decodable {
        let startOffset: Int?
        let endOffset: Int?
        let spans: [Span]?
        enum CodingKeys: String, CodingKey {
            case startOffset, endOffset
            case spans = "Span"
        }
        var text: String {
            (spans ?? []).compactMap(\.text).joined()
        }
    }
    struct Span: Decodable {
        let text: String?
        let startOffset: Int?
        let endOffset: Int?
    }

    var first: Lyrics? { container.lyrics?.first }
}

// MARK: - plex.tv 登录与服务器

struct PlexPin: Decodable {
    let id: Int
    let code: String
    let authToken: String?
    let expiresIn: Int?
}

struct PlexResource: Decodable {
    let name: String?
    let clientIdentifier: String?
    let provides: String?
    let owned: Bool?
    let accessToken: String?
    let connections: [Connection]?

    struct Connection: Decodable {
        let uri: String?
        let address: String?
        let port: Int?
        let local: Bool?
        let relay: Bool?
        let ipv6: Bool?
        /// `protocol` 在 Swift 里是关键字，得改名映射。
        let scheme: String?

        enum CodingKeys: String, CodingKey {
            case uri, address, port, local, relay, ipv6
            case scheme = "protocol"
        }
    }

    var isMediaServer: Bool {
        (provides ?? "").split(separator: ",").contains("server")
    }
}
