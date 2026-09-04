import Foundation

/// 选一条能用的路连到 Plex 服务器。
///
/// 一台服务器会公布好几个地址：局域网 IP、公网域名、Plex 中继。哪条能用取决
/// 于电视此刻在哪个网络里，只能一条条试。
///
/// ## 必须校验 machineIdentifier
///
/// 这不是防御性编程，是这套部署里真实存在的坑：**用户家里的网段和外地那套
/// 房子的网段都是 `192.168.31.x`**（一大堆路由器的出厂默认）。于是电视在
/// 外地试家里那条局域网地址 `192.168.31.185:32400` 时，很可能真的连上 ——
/// 连上的是外地这边同一个网段上的另一台设备。
///
/// 只看"端口通不通"会选中错的机器。所以每条候选连接都要问一句 `/identity`，
/// 核对 machineIdentifier 是不是我们要的那台，对不上就当这条路不存在。
struct PlexConnection: Hashable, Codable {
    let baseURL: String
    let token: String
    let machineIdentifier: String
    let isLocal: Bool
    let isRelay: Bool

    /// 相对路径拼成完整 URL，顺带把 token 带上。
    ///
    /// AVPlayer 只吃 URL，塞不进自定义请求头 —— 所以**播放地址**这一种情况
    /// 必须把 token 放在查询串里，没有别的办法。其余请求走 `headers`。
    func url(_ path: String, query: [String: String] = [:], includeTokenInQuery: Bool = false) -> URL? {
        guard var components = URLComponents(string: baseURL + path) else { return nil }
        var items = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        if includeTokenInQuery {
            items.append(URLQueryItem(name: "X-Plex-Token", value: token))
        }
        if !items.isEmpty {
            components.queryItems = (components.queryItems ?? []) + items
        }
        return components.url
    }

    var headers: [String: String] {
        var result = PlexAuth.headers
        result["X-Plex-Token"] = token
        return result
    }
}

enum PlexServerPicker {
    /// 一条连接最多等这么久。
    ///
    /// 给得短是故意的：不通的局域网地址通常是"连接被拒"或者一直没响应，
    /// 而后者会一直挂到超时。所有候选是并发试的，所以这个值决定了用户在
    /// 「正在连接」那个界面上最多站多久。
    static let probeTimeout: TimeInterval = 4.0

    /// 并发试所有候选连接，返回第一条**验明身份**的。
    ///
    /// 排序上局域网优先：同样能连的时候，局域网比绕公网快得多，而 FLAC
    /// 直连一首歌是几十兆，这个差别听得出来（表现为切歌要缓冲）。
    static func pick(from resource: PlexResource, fallbackToken: String) async -> PlexConnection? {
        guard let wanted = resource.clientIdentifier, !wanted.isEmpty else { return nil }
        let token = resource.accessToken ?? fallbackToken
        let candidates = ordered(resource.connections ?? [])
        guard !candidates.isEmpty else { return nil }

        return await withTaskGroup(of: PlexConnection?.self) { group in
            for candidate in candidates {
                guard let uri = candidate.uri, !uri.isEmpty else { continue }
                group.addTask {
                    await verify(
                        baseURL: uri,
                        token: token,
                        expecting: wanted,
                        isLocal: candidate.local ?? false,
                        isRelay: candidate.relay ?? false
                    )
                }
            }
            // 先到先得，但把局域网排在前面已经让"先到"大概率就是最好的那条。
            for await found in group {
                if let found {
                    group.cancelAll()
                    return found
                }
            }
            return nil
        }
    }

    /// 局域网 → 公网直连 → 中继。
    ///
    /// 中继排最后是因为它走 Plex 的服务器转发，带宽被限得很死（实测跑不动
    /// 无损直连），只该在前两种都不通时兜底。
    static func ordered(_ connections: [PlexResource.Connection]) -> [PlexResource.Connection] {
        connections.sorted { left, right in
            func rank(_ item: PlexResource.Connection) -> Int {
                if item.relay ?? false { return 2 }
                if item.local ?? false { return 0 }
                return 1
            }
            return rank(left) < rank(right)
        }
    }

    private static func verify(
        baseURL: String,
        token: String,
        expecting machineIdentifier: String,
        isLocal: Bool,
        isRelay: Bool
    ) async -> PlexConnection? {
        guard let url = URL(string: baseURL + "/identity") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = probeTimeout
        for (key, value) in PlexAuth.headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue(token, forHTTPHeaderField: "X-Plex-Token")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode) else { return nil }
            let identity = try JSONDecoder().decode(PlexIdentity.self, from: data)
            // 这一句就是全部的意义：端口通了不代表是我们要的那台机器。
            guard identity.container.machineIdentifier == machineIdentifier else { return nil }
            return PlexConnection(
                baseURL: baseURL,
                token: token,
                machineIdentifier: machineIdentifier,
                isLocal: isLocal,
                isRelay: isRelay
            )
        } catch {
            return nil
        }
    }
}
