import Combine
import Foundation

/// 把歌缓存到 Apple TV 本地，带容量上限。
///
/// ## 为什么值得做
///
/// 这台电视在外地，音乐在家里的 NAS 上，走公网。实测下行约 3.4 Mbps，
/// 而无损 FLAC 是 1.5 Mbps —— 够播，但余量很薄：网络抖一下就要重新囤。
/// 缓存之后，听过的歌第二次是本地读盘，起播即时、不占带宽、也不会断。
///
/// ## 顺路就能做
///
/// `StreamingAudioEngine` 为了边下边解，本来就把整首歌的字节流过一遍。
/// 所以缓存不需要额外下载 —— 在流过的时候顺手写一份到磁盘（tee），
/// 一分钟的额外带宽都不花。
///
/// ## 上限和淘汰
///
/// Apple TV 的可用存储很有限（32/64GB，还要留给系统和其它应用），所以
/// **必须**有上限，而且要让用户能改。超了按"最久没听过"淘汰（LRU）——
/// 不是按加入时间：一首反复听的老歌比一首听过一次的新歌更该留着。
@MainActor
final class OfflineCache: ObservableObject {
    static let shared = OfflineCache()

    enum Limit: String, CaseIterable {
        case off, small, medium, large, huge

        var bytes: Int64 {
            switch self {
            case .off:    return 0
            case .small:  return 1 << 30           // 1 GB
            case .medium: return 4 * (1 << 30)     // 4 GB
            case .large:  return 8 * (1 << 30)     // 8 GB
            case .huge:   return 16 * (1 << 30)    // 16 GB
            }
        }

        var label: String {
            switch self {
            case .off: return "关闭"
            case .small: return "1 GB"
            case .medium: return "4 GB"
            case .large: return "8 GB"
            case .huge: return "16 GB"
            }
        }
    }

    @Published private(set) var limit: Limit = .medium
    @Published private(set) var usedBytes: Int64 = 0
    @Published private(set) var trackCount: Int = 0

    private static let limitKey = "cache.limit"
    private static let accessKey = "cache.lastAccess"

    private let directory: URL
    /// 每个曲目最后一次被播放的时间，用来做 LRU 淘汰。
    private var lastAccess: [String: Double] = [:]

    private init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("tracks", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        if let saved = UserDefaults.standard.string(forKey: Self.limitKey),
           let parsed = Limit(rawValue: saved) {
            limit = parsed
        }
        lastAccess = (UserDefaults.standard.dictionary(forKey: Self.accessKey) as? [String: Double]) ?? [:]
        recount()
    }

    // MARK: - 对外

    var usedDescription: String { Self.humanBytes(usedBytes) }
    var limitDescription: String { limit.label }

    func setLimit(_ value: Limit) {
        limit = value
        UserDefaults.standard.set(value.rawValue, forKey: Self.limitKey)
        if value == .off { clear() } else { evictIfNeeded() }
    }

    func clear() {
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        lastAccess.removeAll()
        UserDefaults.standard.removeObject(forKey: Self.accessKey)
        recount()
    }

    /// 这首歌在本地有完整副本吗？有就返回它的路径。
    ///
    /// 只认**完整**的副本：写入过程中用 `.partial` 后缀，写完才改名。
    /// 不这么做的话，一次中断的下载会留下一个截断的文件，下次直接播它
    /// 就是播一半没声 —— 而且很难查。
    func localFile(for ratingKey: String) -> URL? {
        let file = path(for: ratingKey)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        touch(ratingKey)
        return file
    }

    /// 开一个写入句柄，让引擎在流式播放时顺手落盘。
    ///
    /// 上限设为关闭、或者这首已经有了，都返回 nil —— 调用方据此跳过 tee。
    func beginWrite(for ratingKey: String) -> CacheWriter? {
        guard limit != .off else { return nil }
        guard localFile(for: ratingKey) == nil else { return nil }
        return CacheWriter(target: path(for: ratingKey), cache: self, ratingKey: ratingKey)
    }

    // MARK: - 内部

    private func path(for ratingKey: String) -> URL {
        // 用 ratingKey 当文件名。它在一台服务器内唯一且稳定，比标题安全
        // （标题里有斜杠、冒号、emoji 的歌在这个库里到处都是）。
        directory.appendingPathComponent("t\(ratingKey).audio")
    }

    fileprivate func finished(ratingKey: String) {
        touch(ratingKey)
        recount()
        evictIfNeeded()
    }

    private func touch(_ ratingKey: String) {
        lastAccess[ratingKey] = Date().timeIntervalSince1970
        UserDefaults.standard.set(lastAccess, forKey: Self.accessKey)
    }

    private func recount() {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey]
        )) ?? []
        let complete = files.filter { $0.pathExtension == "audio" }
        usedBytes = complete.reduce(0) { total, url in
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return total + Int64(size)
        }
        trackCount = complete.count
    }

    /// 超了上限就淘汰最久没听的，直到降到上限的 90% 以下。
    ///
    /// 留 10% 余量是为了避免"每存一首就淘汰一首"的抖动 —— 刚好卡在上限上时，
    /// 每次写入都会触发一次淘汰，磁盘和用户都不好过。
    private func evictIfNeeded() {
        guard limit != .off else { return }
        let ceiling = limit.bytes
        guard usedBytes > ceiling else { return }
        let target = Int64(Double(ceiling) * 0.9)

        var files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.fileSizeKey]
        ))?.filter { $0.pathExtension == "audio" } ?? []

        files.sort { left, right in
            access(of: left) < access(of: right)   // 最久没听的排前面
        }

        var running = usedBytes
        for file in files where running > target {
            let size = Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            try? FileManager.default.removeItem(at: file)
            running -= size
            lastAccess.removeValue(forKey: key(of: file))
        }
        UserDefaults.standard.set(lastAccess, forKey: Self.accessKey)
        recount()
    }

    private func key(of file: URL) -> String {
        String(file.deletingPathExtension().lastPathComponent.dropFirst())  // 去掉 "t"
    }

    private func access(of file: URL) -> Double {
        lastAccess[key(of: file)] ?? 0
    }

    static func humanBytes(_ bytes: Int64) -> String {
        guard bytes > 0 else { return "0 MB" }
        let gb = Double(bytes) / Double(1 << 30)
        if gb >= 1 { return String(format: "%.1f GB", gb) }
        return String(format: "%.0f MB", Double(bytes) / Double(1 << 20))
    }
}

/// 边播边写的落盘句柄。
///
/// 写到 `.partial`，全部收到之后才改名成正式文件 —— 中断留下的半个文件
/// 不会被当成可用缓存。
final class CacheWriter {
    private let target: URL
    private let partial: URL
    private let handle: FileHandle?
    private let ratingKey: String
    private weak var cache: OfflineCache?

    init(target: URL, cache: OfflineCache, ratingKey: String) {
        self.target = target
        self.partial = target.appendingPathExtension("partial")
        self.cache = cache
        self.ratingKey = ratingKey
        FileManager.default.createFile(atPath: partial.path, contents: nil)
        handle = try? FileHandle(forWritingTo: partial)
    }

    func write(_ data: Data) {
        try? handle?.write(contentsOf: data)
    }

    /// `complete` 为 false（下载中断、用户切歌）时把半成品删掉。
    func close(complete: Bool) {
        try? handle?.close()
        guard complete else {
            try? FileManager.default.removeItem(at: partial)
            return
        }
        try? FileManager.default.removeItem(at: target)
        try? FileManager.default.moveItem(at: partial, to: target)
        let key = ratingKey
        Task { @MainActor [weak cache] in cache?.finished(ratingKey: key) }
    }
}
