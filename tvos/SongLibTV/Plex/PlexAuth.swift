import Foundation

/// 电视上的 Plex 登录。
///
/// 电视上打字是件苦差事 —— 用遥控器在网格键盘上戳出一个邮箱加密码要一分钟，
/// 打错一个字符还得从头找退格键。所以这里走 Plex 给电视设计的 PIN 流程：
/// 电视上显示一个四位短码，用户在手机或电脑上打开 plex.tv/link 输一次就完了。
/// 顺带还有二维码，扫一下连码都不用输。
///
/// 拿到的 token 存进 Keychain，之后每次开机直接用。
enum PlexAuth {
    static let clientIdentifierKey = "plex.clientIdentifier"
    static let tokenKey = "plex.authToken"

    /// 这台设备在 Plex 眼里的身份。
    ///
    /// 必须**一次生成、长期不变**：Plex 是按 client identifier 记住"这台设备
    /// 登录过"的，每次开机换一个的话，用户的 Plex 账号里会堆出一长串幽灵设备，
    /// 而且之前授权的那个 PIN 也认不回来。
    static var clientIdentifier: String {
        if let saved = UserDefaults.standard.string(forKey: clientIdentifierKey),
           !saved.isEmpty {
            return saved
        }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: clientIdentifierKey)
        return fresh
    }

    static var headers: [String: String] {
        [
            "Accept": "application/json",
            "X-Plex-Product": "SongLib TV",
            "X-Plex-Version": Bundle.main.shortVersion,
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Platform": "tvOS",
            "X-Plex-Platform-Version": ProcessInfo.processInfo.operatingSystemVersionString,
            "X-Plex-Device": "Apple TV",
            "X-Plex-Device-Name": "Apple TV",
            "X-Plex-Model": "AppleTV",
        ]
    }

    // MARK: - PIN 流程

    static func requestPin() async throws -> PlexPin {
        var request = URLRequest(url: URL(string: "https://plex.tv/api/v2/pins")!)
        request.httpMethod = "POST"
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await URLSession.shared.data(for: request)
        try PlexError.check(response, data: data, what: "申请配对码")
        return try JSONDecoder().decode(PlexPin.self, from: data)
    }

    /// 轮询这个码有没有被认领。认领了就返回 token。
    static func checkPin(id: Int) async throws -> String? {
        var request = URLRequest(url: URL(string: "https://plex.tv/api/v2/pins/\(id)")!)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await URLSession.shared.data(for: request)
        try PlexError.check(response, data: data, what: "查询配对状态")
        let pin = try JSONDecoder().decode(PlexPin.self, from: data)
        guard let token = pin.authToken, !token.isEmpty else { return nil }
        return token
    }

    static func qrURL(for code: String) -> URL? {
        URL(string: "https://plex.tv/api/v2/pins/qr/\(code)")
    }

    // MARK: - 服务器发现

    /// 列出这个账号能用的 Plex 服务器及其所有连接方式。
    ///
    /// `includeHttps` 和 `includeRelay` 都要开：外地看家里的库时，走的往往是
    /// 服务器自己的公网域名（https），实在不行才走 Plex 中继。
    static func resources(token: String) async throws -> [PlexResource] {
        var components = URLComponents(string: "https://plex.tv/api/v2/resources")!
        components.queryItems = [
            URLQueryItem(name: "includeHttps", value: "1"),
            URLQueryItem(name: "includeRelay", value: "1"),
            URLQueryItem(name: "includeIPv6", value: "1"),
        ]
        var request = URLRequest(url: components.url!)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue(token, forHTTPHeaderField: "X-Plex-Token")
        let (data, response) = try await URLSession.shared.data(for: request)
        try PlexError.check(response, data: data, what: "读取服务器列表")
        return try JSONDecoder().decode([PlexResource].self, from: data)
    }
}

// MARK: - Keychain

/// Token 存 Keychain，不存 UserDefaults。
///
/// UserDefaults 的 plist 是明文，任何能读到应用容器的人都能拿走这个 token ——
/// 而 Plex 的 token 等于整个媒体库的通行证。
enum TokenStore {
    private static let service = "cn.playsong.songlib.tv"

    static func save(_ token: String, key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var insert = query
        insert[kSecValueData as String] = Data(token.utf8)
        // 电视是开机就在用的设备，没有"解锁"这个动作。用 AfterFirstUnlock
        // 之外的等级会导致重启后读不出来。
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ] as CFDictionary)
    }
}

// MARK: - 错误

struct PlexError: LocalizedError {
    let message: String
    var errorDescription: String? { message }

    static func check(_ response: URLResponse, data: Data, what: String) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw PlexError(message: "\(what)失败（HTTP \(http.statusCode)）")
        }
    }
}

extension Bundle {
    var shortVersion: String {
        (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0"
    }
}
