import Foundation

/// 读库：音乐库、专辑、曲目、播放列表、搜索、歌词。
struct PlexLibrary {
    let connection: PlexConnection

    // MARK: - 底层请求

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type) async throws -> T {
        guard let url = connection.url(path, query: query) else {
            throw PlexError(message: "地址拼不出来：\(path)")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        for (key, value) in connection.headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await URLSession.shared.data(for: request)
        try PlexError.check(response, data: data, what: "读取 \(path)")
        return try JSONDecoder().decode(type, from: data)
    }

    // MARK: - 音乐库

    /// 找出音乐库的 section id。
    ///
    /// 一台服务器上电影、剧集、音乐混在一起（实测这台有 14 个库），
    /// 只有 `type == "artist"` 的才是音乐。
    func musicSections() async throws -> [PlexItem] {
        struct Sections: Decodable {
            let container: Container
            struct Container: Decodable {
                let directories: [Directory]?
                enum CodingKeys: String, CodingKey { case directories = "Directory" }
            }
            struct Directory: Decodable {
                let key: String?
                let type: String?
                let title: String?
            }
            enum CodingKeys: String, CodingKey { case container = "MediaContainer" }
        }
        let found = try await get("/library/sections", as: Sections.self)
        return (found.container.directories ?? [])
            .filter { $0.type == "artist" }
            .compactMap { directory in
                guard let key = directory.key else { return nil }
                return PlexItem(
                    ratingKey: key, key: nil, type: "section",
                    title: directory.title, parentTitle: nil, grandparentTitle: nil,
                    parentRatingKey: nil, grandparentRatingKey: nil,
                    thumb: nil, parentThumb: nil, grandparentThumb: nil, art: nil,
                    duration: nil, index: nil, year: nil, addedAt: nil,
                    leafCount: nil, playlistType: nil, media: nil
                )
            }
    }

    /// Plex 的 type 编号：8 艺人、9 专辑、10 曲目。
    enum ItemType: Int {
        case artist = 8, album = 9, track = 10
    }

    func browse(
        section: String,
        type: ItemType,
        sort: String = "addedAt:desc",
        start: Int = 0,
        size: Int = 60
    ) async throws -> [PlexItem] {
        try await get(
            "/library/sections/\(section)/all",
            query: [
                "type": String(type.rawValue),
                "sort": sort,
                "X-Plex-Container-Start": String(start),
                "X-Plex-Container-Size": String(size),
            ],
            as: PlexEnvelope<PlexItem>.self
        ).items
    }

    /// 专辑里的曲目（或艺人下的专辑）。
    func children(of ratingKey: String) async throws -> [PlexItem] {
        try await get("/library/metadata/\(ratingKey)/children", as: PlexEnvelope<PlexItem>.self).items
    }

    // MARK: - 播放列表

    func playlists() async throws -> [PlexItem] {
        try await get("/playlists", query: ["playlistType": "audio"], as: PlexEnvelope<PlexItem>.self)
            .items
            // 空列表在电视上点进去只会看到一片空白，不如不显示。
            .filter { ($0.leafCount ?? 0) > 0 }
    }

    /// 播放列表内容。
    ///
    /// **这里必然会遇到失败。** 实测这个库的 23 个音频播放列表里有 13 个
    /// 取内容时返回 HTTP 500 —— 都是标题重复的僵尸记录，Plex 自己也读不出来。
    /// 所以调用方要能接住错误，不能让一个坏列表把整个页面搞崩。
    func playlistItems(_ ratingKey: String) async throws -> [PlexItem] {
        try await get("/playlists/\(ratingKey)/items", as: PlexEnvelope<PlexItem>.self).items
    }

    // MARK: - 搜索

    func search(_ query: String, limit: Int = 24) async throws -> (tracks: [PlexItem], albums: [PlexItem], artists: [PlexItem]) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return ([], [], []) }
        let found = try await get(
            "/hubs/search",
            query: ["query": trimmed, "limit": String(limit)],
            as: PlexSearchEnvelope.self
        )
        return (found.items(ofType: "track"), found.items(ofType: "album"), found.items(ofType: "artist"))
    }

    // MARK: - 歌词

    /// 取一首歌的歌词时间轴。
    ///
    /// 两步：先读元数据找到 `streamType == 4` 的那条流，再取它的内容。
    /// 没有歌词流就返回 nil —— 调用方该显示一个体面的无歌词界面，
    /// 而不是一片空白。
    func lyrics(for ratingKey: String) async throws -> LyricsTimeline? {
        let metadata = try await get(
            "/library/metadata/\(ratingKey)",
            query: ["includeLyrics": "1"],
            as: PlexEnvelope<PlexItem>.self
        )
        guard let track = metadata.items.first,
              let streamKey = track.media?
                  .compactMap({ $0.parts?.first })
                  .compactMap({ $0.streams?.first(where: \.isLyrics) })
                  .first?.key
        else { return nil }

        let payload = try await get(streamKey, as: PlexLyricsEnvelope.self)
        guard let lyrics = payload.first, let lines = lyrics.lines else { return nil }
        return LyricsTimeline(
            lines: lines.compactMap { line in
                guard let start = line.startOffset else { return nil }
                return LyricsTimeline.Line(
                    start: Double(start) / 1000.0,
                    end: line.endOffset.map { Double($0) / 1000.0 },
                    text: line.text.trimmingCharacters(in: .whitespaces)
                )
            },
            isTimed: lyrics.timed ?? true
        )
    }

    // MARK: - 播放地址与封面

    /// 直连播放地址。
    ///
    /// 走 `Part.key` 就是原始文件本身 —— 这个库 95% 是 FLAC，AVPlayer 自己
    /// 就能解，没必要让 Plex 转码。转码除了糟蹋音质，还会占服务器的转码名额
    /// （之前在网页端被这个坑过：名额耗尽表现为"某些码率稳定失败"）。
    func streamURL(for track: PlexItem) -> URL? {
        guard let key = track.firstPart?.key else { return nil }
        return connection.url(key, includeTokenInQuery: true)
    }

    /// 封面地址。走 Plex 的缩放接口，别把 1000×1000 的原图拉到电视上。
    func coverURL(for item: PlexItem, size: Int) -> URL? {
        guard let path = item.coverPath else { return nil }
        return connection.url(
            "/photo/:/transcode",
            query: [
                "width": String(size),
                "height": String(size),
                "minSize": "1",
                "upscale": "1",
                "url": path,
            ],
            includeTokenInQuery: true
        )
    }

    // MARK: - 上报播放进度

    /// 告诉 Plex "这台电视正在放这首"。
    ///
    /// 有两个好处，都不是锦上添花：Plex 的"最近播放"会算上电视这一路；
    /// 而 songlib 网页端那个"跟随其他设备播放"的列表也会看见这台 Apple TV，
    /// 于是手机上能看到电视在放什么。
    func reportTimeline(track: PlexItem, positionSeconds: Double, state: String) async {
        let query: [String: String] = [
            "ratingKey": track.ratingKey,
            "key": "/library/metadata/\(track.ratingKey)",
            "state": state,
            "time": String(Int(positionSeconds * 1000)),
            "duration": String(track.duration ?? 0),
            "playbackTime": String(Int(positionSeconds * 1000)),
        ]
        guard let url = connection.url("/:/timeline", query: query) else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        for (key, value) in connection.headers { request.setValue(value, forHTTPHeaderField: key) }
        // 上报失败不该影响播放，所以吞掉错误。
        _ = try? await URLSession.shared.data(for: request)
    }
}
