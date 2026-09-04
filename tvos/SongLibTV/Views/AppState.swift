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
    /// 配对过程的诊断，直接显示在登录页上。
    ///
    /// tvOS 的 `--console` 抓不到 stdout，统一日志也拉不下来 —— 而用户报的是
    /// "配对码不停更新、输哪个都不行"。把状态摆在屏幕上，是这个平台上唯一
    /// 可靠的观察手段，而且用户自己也能看懂发生了什么。
    @Published private(set) var diagnostics: [String] = []

    /// 这台服务器上所有音乐库，以及当前选中的那个。
    ///
    /// 必须能选：Plexamp 连上之后就是让你挑资料库的。实测这台服务器有 14 个
    /// 库，其中音乐库可能不止一个（分类库、精选库、有声书库都常见），
    /// 默认拿第一个是错的。选择记在本地，下次开机直接用。
    @Published private(set) var sections: [PlexItem] = []
    /// 当前库。注意**没有** didSet 自动持久化 —— 见 `select(section:)`。
    @Published private(set) var sectionKey: String?
    private static let sectionDefaultsKey = "plex.selectedSection"

    var sectionTitle: String {
        sections.first { $0.ratingKey == sectionKey }?.displayTitle ?? "音乐库"
    }

    /// 用户亲自选的库才记住。
    ///
    /// 之前是在 sectionKey 的 didSet 里无条件写盘，于是**自动挑的**那个也被
    /// 当成"用户的选择"记住了 —— 一旦第一次自动挑错（挑到空的「测试」库），
    /// 之后每次开机都会尊重这个错误的"选择"，按曲目数重挑的逻辑再也不会跑。
    func select(section: PlexItem) {
        guard section.ratingKey != sectionKey else { return }
        sectionKey = section.ratingKey
        UserDefaults.standard.set(section.ratingKey, forKey: Self.sectionDefaultsKey)
    }

    func signOutAndForget() {
        UserDefaults.standard.removeObject(forKey: Self.sectionDefaultsKey)
        signOut()
    }

    /// 连上之后把库列出来，并挑一个：上次选过的优先，否则第一个。
    func loadSections() async {
        guard let library else { return }
        let found = (try? await library.musicSections()) ?? []
        sections = found
        let remembered = UserDefaults.standard.string(forKey: Self.sectionDefaultsKey)
        if let remembered, found.contains(where: { $0.ratingKey == remembered }) {
            sectionKey = remembered
            return
        }
        // 没有记住过的选择时，挑**曲目最多**的那个，而不是第一个。
        //
        // 实测这台服务器有两个音乐库：「测试」是空的、「音乐」有三千多首。
        // 按顺序拿第一个会让用户一进来就面对一个空库 —— 他会以为应用坏了。
        guard !found.isEmpty else { sectionKey = nil; return }
        var best = found[0]
        var bestCount = -1
        for candidate in found {
            let count = await library.trackCount(section: candidate.ratingKey)
            if count > bestCount { bestCount = count; best = candidate }
        }
        sectionKey = best.ratingKey
        note("默认选中「\(best.displayTitle)」（\(bestCount) 首）")
    }

    private var pollTask: Task<Void, Never>?
    private var pinRequests = 0
    private var polls = 0

    private func note(_ line: String) {
        let stamp = Date().formatted(date: .omitted, time: .standard)
        diagnostics.append("\(stamp)  \(line)")
        if diagnostics.count > 8 { diagnostics.removeFirst(diagnostics.count - 8) }
    }

    var library: PlexLibrary? {
        connection.map { PlexLibrary(connection: $0) }
    }

    // MARK: - 开机

    func boot() {
#if DEBUG
        // 调试通道：`-plexToken <token>` 直接注入，跳过配对。
        //
        // 存在的理由是把问题分开：配对流程有 bug 时，不该连"界面和播放能不能
        // 用"都一起验不了。只在 DEBUG 里编译。
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-plexToken"), i + 1 < args.count {
            let injected = args[i + 1]
            if !injected.isEmpty {
                note("用启动参数注入的 token 直连")
                TokenStore.save(injected, key: PlexAuth.tokenKey)
                connect(token: injected)
                return
            }
        }
#endif
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
        // 谁在反复发起配对，只有日志说得清 —— 用户报「配对码不停更新」，
        // 而正常情况下一个码有 15 分钟有效期。
        pinRequests += 1
        note("发起配对 第 \(pinRequests) 次（上一个码 \(pin?.code ?? "无")）")
        pollTask?.cancel()
        failure = nil
        pin = nil
        pollTask = Task { [weak self] in
            guard let self else { return }
            do {
                let fresh = try await PlexAuth.requestPin()
                await MainActor.run {
                    self.pin = fresh
                    self.note("拿到码 \(fresh.code)  id=\(fresh.id)  有效 \(fresh.expiresIn ?? -1)s")
                }
                try await self.waitForAuthorization(pin: fresh)
            } catch {
                await MainActor.run {
                    self.note("配对报错：\(error.localizedDescription)")
                    self.failure = error.localizedDescription
                }
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
            let polled = try await PlexAuth.checkPin(id: pin.id)
            await MainActor.run {
                self.polls += 1
                if self.polls % 5 == 0 || polled != nil {
                    self.note("轮询 \(self.polls) 次 -> \(polled == nil ? "还没被认领" : "已认领，拿到 token")")
                }
            }
            if let token = polled {
                TokenStore.save(token, key: PlexAuth.tokenKey)
                await MainActor.run {
                    self.pin = nil
                    self.connect(token: token)
                }
                return
            }
        }
        // 码过期了就自动换一个，不要求用户回来点重试。
        if !Task.isCancelled {
            await MainActor.run { self.note("这个码到期了，换一个新的") }
            startPairing()
        }
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
                        await self.loadSections()
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
