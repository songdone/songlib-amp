import SwiftUI

/// 设计系统。
///
/// 电视和手机是两种完全不同的设备，这里每个数值都是为电视定的：
///
/// 1. **观看距离三米，不是三十厘米。** 手机上舒服的字号在电视上是一片蚂蚁。
///    正文起步 30pt，歌词主行 64pt —— 按 1920×1080 的点阵算，相当于手机上的
///    超大号标题。
/// 2. **画面投在一面很大、通常很暗的墙上。** 纯黑底配纯白字会晃眼，边缘还会
///    渗光。所以底色是带暖调的近黑，最亮的字压在纯白之下。
/// 3. **没有指针，只有焦点。** 「现在选中哪个」必须靠尺寸、亮度、阴影同时说话，
///    隔三米看才分得出来。
enum Theme {

    // MARK: - 颜色

    /// 底色不用 #000：纯黑在 OLED 上和熄灭的像素无法区分，画面边界会消失；
    /// 在 LCD 上又会因背光漏光显出一块块不均匀的灰。近黑两边都稳。
    static let canvas = Color(red: 0.043, green: 0.039, blue: 0.047)
    static let surface = Color.white.opacity(0.07)
    static let surfaceStrong = Color.white.opacity(0.12)
    static let hairline = Color.white.opacity(0.14)

    static let textPrimary = Color.white.opacity(0.95)
    static let textSecondary = Color.white.opacity(0.64)
    static let textTertiary = Color.white.opacity(0.40)

    /// 歌词三档亮度。差距拉得比手机上大得多 —— 三米外只有强对比才分得出
    /// 哪行是当前行。
    static let lyricActive = Color(red: 1.0, green: 0.99, blue: 0.97)
    static let lyricNear = Color.white.opacity(0.42)
    static let lyricFar = Color.white.opacity(0.16)

    // MARK: - 字号

    enum Size {
        static let display: CGFloat = 76      // 登录页大标题
        static let title: CGFloat = 46        // 页面标题
        static let sectionHeader: CGFloat = 32
        static let cardTitle: CGFloat = 25
        static let cardSubtitle: CGFloat = 21
        static let body: CGFloat = 30
        static let caption: CGFloat = 23

        static let lyricActive: CGFloat = 64
        static let lyricIdle: CGFloat = 40
        /// 槽位高度按主行字号推，字号一改行距跟着走，版式不会散架。
        static let lyricSlot: CGFloat = lyricActive * 1.78
    }

    // MARK: - 间距

    /// 电视有过扫描区，四周必须留够。tvOS 自己的安全区约 60/90，
    /// 这里再往里收一点，让内容不贴着安全区边缘。
    static let screenH: CGFloat = 96
    static let screenV: CGFloat = 56
    static let cardGap: CGFloat = 36
    static let shelfGap: CGFloat = 52

    static let radiusCard: CGFloat = 14
    static let radiusPanel: CGFloat = 24

    // MARK: - 动效
    //
    // 统一在这里，是为了让整个应用的手感一致。散落在各个视图里写
    // `.animation(.easeInOut(duration: 0.3))` 的结果是每个地方都差一点，
    // 合起来就是"廉价"。

    enum Motion {
        /// 焦点移动。要快、要有一点回弹 —— 这是 tvOS 的标志性手感。
        static let focus = Animation.spring(response: 0.34, dampingFraction: 0.72)
        /// 歌词换行。比焦点慢一点、阻尼高一点，避免在大字号上显得晃。
        static let lyric = Animation.spring(response: 0.52, dampingFraction: 0.86)
        /// 内容淡入淡出（换歌、换背景）。
        static let content = Animation.easeInOut(duration: 0.55)
        /// 大面积背景过渡。慢，让它不抢注意力。
        static let ambient = Animation.easeInOut(duration: 1.1)
    }
}

extension Font {
    static func tv(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight)
    }
}

// MARK: - 焦点

/// tvOS 上「选中」的标准反馈：放大 + 抬起 + 高光。
///
/// 三个一起用才够清楚。只放大不加阴影，在深色背景上看不出层次；
/// 只加阴影不放大，隔三米根本注意不到。
struct FocusLift: ViewModifier {
    let focused: Bool
    var scale: CGFloat = 1.08
    var radius: CGFloat = Theme.radiusCard

    func body(content: Content) -> some View {
        content
            .scaleEffect(focused ? scale : 1)
            .shadow(color: .black.opacity(focused ? 0.55 : 0.28),
                    radius: focused ? 34 : 14,
                    y: focused ? 18 : 8)
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color.white.opacity(focused ? 0.45 : 0), lineWidth: 3)
            )
            .animation(Theme.Motion.focus, value: focused)
    }
}

extension View {
    func focusLift(_ focused: Bool, scale: CGFloat = 1.08, radius: CGFloat = Theme.radiusCard) -> some View {
        modifier(FocusLift(focused: focused, scale: scale, radius: radius))
    }
}
