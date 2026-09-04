import Foundation

/// 应用的全局状态：登录、选服务器、拿到可用的库。
@MainActor
final class AppState: ObservableObject {
    enum Phase {
        case checking          // 开机，看 Keychain 里有没有 token
        case signedOut         // 要走 PIN 配对
        case connecting        // 有 token，正在挑一条能用的连接
        case ready             // 可以用了
    }

    @Published private(set) var phase: Phase = .checking
    @Published private(set) var pin: PlexPin?
    @Published private(set) var failure: String?
    @Published private(set) var connection: PlexConnection?
    @Published private(set) var serverName: String = ""

    private var pollTask: Task<Void, Never>?

    var library: PlexLibrary? {
        connection.map { PlexLibrary(connection: $0) }
    }

    // MARK: - 开机

    func boot() {
        if let token = TokenStore.read(key: PlexAuth.tokenKey), !token.isEmpty {
            connect(token: token)
        } else {
            phase = .signedOut
        }
    }

    func signOut() {
        TokenStore.delete(key: PlexAuth.tokenKey)
        connection = nil
        serverName = ""
        pin = nil
        phase = .signedOut
    }

    // MARK: - 配对

    func startPairing() {
        pollTask?.cancel()
        failure = nil
        pin = nil
        pollTask = Task { [weak self] in
            guard let self else { return }
            do {
                let fresh = try await PlexAuth.requestPin()
                await MainActor.run { self.pin = fresh }
                try await self.waitForAuthorization(pin: fresh)
            } catch {
                await MainActor.run { self.failure = error.localizedDescription }
            }
        }
    }

    /// 轮询这个码有没有被认领。
    ///
    /// 间隔 2 秒：再快只是白打请求（用户在手机上输码本来就要十几秒），
    /// 再慢则会让"输完了但电视还没反应"的空档长到让人以为没生效。
    private func waitForAuthorization(pin: PlexPin) async throws {
        let deadline = Date().addingTimeInterval(Double(pin.expiresIn ?? 900))
        while !Task.isCancelled, Date() < deadline {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if Task.isCancelled { return }
            if let token = try await PlexAuth.checkPin(id: pin.id) {
                TokenStore.save(token, key: PlexAuth.tokenKey)
                await MainActor.run {
                    self.pin = nil
                    self.connect(token: token)
                }
                return
            }
        }
        // 码过期了就自动换一个，不要求用户回来点重试。
        if !Task.isCancelled { startPairing() }
    }

    // MARK: - 连接

    private func connect(token: String) {
        phase = .connecting
        failure = nil
        Task { [weak self] in
            guard let self else { return }
            do {
                let resources = try await PlexAuth.resources(token: token)
                let servers = resources.filter(\.isMediaServer)
                guard !servers.isEmpty else {
                    await MainActor.run {
                        self.failure = "这个 Plex 账号下没有可用的媒体服务器"
                        self.phase = .signedOut
                    }
                    return
                }
                // 自己的服务器优先 —— 共享库通常没有本地连接，也不该抢在前面。
                let ordered = servers.sorted { ($0.owned ?? false) && !($1.owned ?? false) }
                for server in ordered {
                    if let picked = await PlexServerPicker.pick(from: server, fallbackToken: token) {
                        await MainActor.run {
                            self.connection = picked
                            self.serverName = server.name ?? "Plex"
                            self.phase = .ready
                        }
                        return
                    }
                }
                await MainActor.run {
                    self.failure = "连不上你的 Plex 服务器。检查一下电视的网络，或者服务器是不是没开。"
                    self.phase = .signedOut
                }
            } catch {
                await MainActor.run {
                    // token 失效（比如在 Plex 网站上撤销了这台设备）要退回配对，
                    // 而不是卡在"连接中"。
                    self.failure = error.localizedDescription
                    self.phase = .signedOut
                }
            }
        }
    }
}
