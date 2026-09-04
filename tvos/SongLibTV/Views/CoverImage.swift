import SwiftUI

/// 封面图。
///
/// 不用 `AsyncImage`：它每次视图重建都会重新发请求，而歌词界面是按帧刷的，
/// 那等于对着 Plex 打一秒几十个图片请求。这里自己缓存，一个地址只取一次。
actor CoverCache {
    static let shared = CoverCache()
    private var images: [URL: UIImage] = [:]
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    func image(for url: URL) async -> UIImage? {
        if let found = images[url] { return found }
        if let running = inFlight[url] { return await running.value }
        let task = Task<UIImage?, Never> {
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            guard let (data, _) = try? await URLSession.shared.data(for: request),
                  let image = UIImage(data: data) else { return nil }
            return image
        }
        inFlight[url] = task
        let result = await task.value
        inFlight[url] = nil
        if let result {
            // 缓存有上限：一屏专辑墙几十张图，不设限的话翻久了会把内存吃光。
            if images.count > 120 { images.removeAll() }
            images[url] = result
        }
        return result
    }
}

struct CoverImage: View {
    let url: URL?
    var cornerRadius: CGFloat = Theme.cornerRadius
    /// 没有封面时用标题的首字兜底，比一个灰方块像样。
    var fallbackText: String = ""

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                LinearGradient(
                    colors: [Color.white.opacity(0.10), Color.white.opacity(0.04)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                Text(fallbackText.isEmpty ? "" : String(fallbackText.prefix(1)))
                    .font(.system(size: 64, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: url) {
            guard let url else { image = nil; return }
            image = await CoverCache.shared.image(for: url)
        }
    }
}
