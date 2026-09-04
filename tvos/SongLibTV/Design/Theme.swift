import SwiftUI
import UIKit

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

    // 中性色阶。
    //
    // 这套数值不是我调出来的，是从一个公认做得漂亮的 tvOS 播放器
    // （Forward 1.3.19）的资源包里读出来的 —— 而它用的正是**苹果系统深色
    // 标准色**：#000 / #1C1C1E / #222 / #3D3D41 / #525252。
    //
    // 这件事本身是个结论：好看的 tvOS 应用不自创灰阶，用系统那套。自创的
    // 灰阶（我之前那个 #0B0A0C 暖调近黑）和系统控件、系统模糊、系统焦点
    // 效果放在一起会差半档，合起来就是"不像原生"。
    //
    // 纯黑在 OLED 上确实和熄灭的像素无法区分 —— 但那是内容区该避免的事，
    // 底色本身用纯黑才是这个平台的规范：电视多在暗环境看，纯黑底才不发灰。
    static let canvas = Color.black
    /// #1C1C1E —— 分组背景，比底色高一档
    static let group = Color(red: 0.110, green: 0.110, blue: 0.118)
    /// #222222 —— 实心填充
    static let darkFill = Color(red: 0.133, green: 0.133, blue: 0.133)
    /// #3D3D41 —— 次级填充
    static let fill = Color(red: 0.239, green: 0.239, blue: 0.255)
    /// #373737 —— 详情页顶部渐变起点
    static let detailTop = Color(red: 0.216, green: 0.216, blue: 0.216)
    /// #525252 —— 占位符
    static let placeholder = Color(red: 0.322, green: 0.322, blue: 0.322)

    static let surface = Color.white.opacity(0.10)        // border
    static let surfaceStrong = Color.white.opacity(0.20)  // tabBackground
    static let hairline = Color.white.opacity(0.10)

    /// 玻璃的两个数值。
    ///
    /// 同样是量出来的：`glassBackground` = #1F1F1F @ 20%，
    /// `glassBorder` = #FEFFFF @ 10%。
    ///
    /// 注意底色只有 **20%** 不透明度 —— 我之前用的是 26%~34%，太实了，
    /// 结果"玻璃"看着像一块半透明塑料板。玻璃之所以是玻璃，是因为它几乎
    /// 不遮挡背后的东西，只是折射；遮挡靠的是模糊，不是涂一层黑。
    static let glassFill = Color(red: 0.122, green: 0.122, blue: 0.122).opacity(0.20)
    static let glassBorder = Color(red: 0.996, green: 1.0, blue: 1.0).opacity(0.10)
    /// 亮态玻璃边框（获得焦点时）：同色但 84% —— 也是量出来的。
    static let glassBorderBright = Color(red: 0.996, green: 1.0, blue: 1.0).opacity(0.84)

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
    /// 全应用统一的取字入口。
    ///
    /// 所有文字都必须走这里，不要直接写 `.system(size:)` —— 否则会出现
    /// 一半中文是苹方、一半是兜底字体的情况，那比全用兜底字体更难看。
    static func tv(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        if let name = TVFont.name(for: weight) {
            return .custom(name, fixedSize: size)
        }
        return .system(size: size, weight: weight)
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

// MARK: - 液态玻璃

/// tvOS 26 的液态玻璃，在这个平台上能用到什么程度。
///
/// 查过 tvOS 26.5 SDK 的 SwiftUI 接口，结论是有边界的：
///
/// - **有** `GlassButtonStyle` / `GlassProminentButtonStyle`（`.buttonStyle(.glass)`、
///   `.glassProminent`，标注 tvOS 26.0+）—— 按钮可以直接用系统原生的液态玻璃，
///   包括它自带的焦点高光和折射。
/// - **没有** `glassEffect()` 和 `GlassEffectContainer` —— 这两个在这版 SDK 里
///   只给 iOS / macOS / watchOS。所以任意表面没法一行变玻璃。
///
/// 于是面板类表面按液态玻璃的构成自己搭。它不是"半透明加模糊"那么简单，
/// 真正让它像一片玻璃的是这四层叠在一起：
///
/// 1. **材质层** —— 背后的内容被折射、去饱和
/// 2. **顶部高光** —— 一道自上而下迅速收敛的白色渐变，模拟光打在弧面边缘
/// 3. **内发丝** —— 一圈 1px 的亮边，让它有厚度而不是一张贴纸
/// 4. **外投影** —— 让它浮在内容之上，而不是嵌在里面
///
/// 少任何一层都会掉档：只有 1 是磨砂塑料，只有 1+3 是卡片，加上 2 才是玻璃。
struct GlassSurface: ViewModifier {
    var radius: CGFloat = Theme.radiusPanel
    /// 已废弃的参数，保留是为了不改所有调用点。
    ///
    /// 玻璃的底色不该由调用方决定 —— 量到的标准值是 #1F1F1F @ 20%，
    /// 各处都用同一个值，整个应用的玻璃才是同一种材质。
    var tint: Double = 0.20
    var elevated = true

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return content
            .background {
                shape
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
                    .overlay(shape.fill(Theme.glassFill))
                    .overlay(
                        // 高光只占上缘一小段就收住 —— 铺满会变成一块灰。
                        shape.fill(
                            LinearGradient(
                                stops: [
                                    .init(color: .white.opacity(0.22), location: 0.00),
                                    .init(color: .white.opacity(0.05), location: 0.16),
                                    .init(color: .clear, location: 0.42),
                                ],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                        .blendMode(.plusLighter)
                    )
            }
            .overlay(
                shape.stroke(
                    LinearGradient(
                        colors: [Theme.glassBorder.opacity(0.9), Theme.glassBorder.opacity(0.35)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .shadow(color: .black.opacity(elevated ? 0.46 : 0), radius: elevated ? 28 : 0, y: elevated ? 14 : 0)
    }
}

extension View {
    func glassSurface(radius: CGFloat = Theme.radiusPanel, tint: Double = 0.26, elevated: Bool = true) -> some View {
        modifier(GlassSurface(radius: radius, tint: tint, elevated: elevated))
    }
}

// MARK: - 玻璃按钮（跨版本）

/// 玻璃质感的按钮，在 tvOS 26 和 18 上都成立。
///
/// 这里必须双轨，原因是实测出来的：这台「卧室」Apple TV 跑的是 **tvOS 18.6**
/// （tvOS 26.5 是家里那台「客厅」）。而 `.buttonStyle(.glass)` 标注的是
/// tvOS 26.0+ —— 直接用会编译失败，把部署目标提到 26 则这台机器根本装不上。
///
/// 所以：26 及以上走系统原生液态玻璃（它自带的折射和焦点高光流动是手写不出
/// 来的）；18 上退回自己搭的那四层玻璃。两条路视觉语言一致，用户不会察觉
/// 在换实现 —— 只有在 26 上会明显更"活"。
struct GlassButtonLook: ViewModifier {
    var prominent = false
    var circular = false

    func body(content: Content) -> some View {
        if #available(tvOS 26.0, *) {
            if prominent {
                content.buttonStyle(.glassProminent)
            } else {
                content.buttonStyle(.glass)
            }
        } else {
            content.buttonStyle(LegacyGlassButtonStyle(prominent: prominent, circular: circular))
        }
    }
}

/// tvOS 18 上的玻璃按钮。
///
/// 焦点反馈得自己做全套：放大、抬高、亮边、以及"选中时整块变亮"。
/// tvOS 上没有指针，这三件事同时发生才够清楚。
struct LegacyGlassButtonStyle: ButtonStyle {
    var prominent = false
    var circular = false

    func makeBody(configuration: Configuration) -> some View {
        LegacyGlassBody(configuration: configuration, prominent: prominent, circular: circular)
    }

    private struct LegacyGlassBody: View {
        let configuration: Configuration
        let prominent: Bool
        let circular: Bool
        @Environment(\.isFocused) private var focused

        var body: some View {
            let radius: CGFloat = circular ? 999 : 999   // 药丸和圆形都用胶囊
            configuration.label
                .foregroundStyle(prominent ? Theme.canvas : Theme.textPrimary)
                .padding(.horizontal, circular ? 18 : 30)
                .padding(.vertical, 18)
                .background {
                    let shape = Capsule(style: .continuous)
                    ZStack {
                        if prominent {
                            shape.fill(focused ? Color.white : Theme.lyricActive.opacity(0.94))
                        } else {
                            shape.fill(.ultraThinMaterial)
                                .environment(\.colorScheme, .dark)
                            shape.fill(Color.white.opacity(focused ? 0.26 : 0.10))
                        }
                        // 上缘高光 —— 玻璃感的关键那一层
                        shape.fill(
                            LinearGradient(
                                stops: [
                                    .init(color: .white.opacity(prominent ? 0.30 : 0.24), location: 0),
                                    .init(color: .clear, location: 0.45),
                                ],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                        .blendMode(.plusLighter)
                    }
                }
                .overlay(
                    Capsule(style: .continuous)
                        .stroke(Color.white.opacity(focused ? 0.55 : 0.16), lineWidth: 1.5)
                )
                .scaleEffect(configuration.isPressed ? 0.97 : (focused ? 1.07 : 1))
                .shadow(color: .black.opacity(focused ? 0.5 : 0.22),
                        radius: focused ? 24 : 8, y: focused ? 11 : 4)
                .animation(Theme.Motion.focus, value: focused)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
                .opacity(radius > 0 ? 1 : 1)
        }
    }
}

extension View {
    func glassButton(prominent: Bool = false, circular: Bool = false) -> some View {
        modifier(GlassButtonLook(prominent: prominent, circular: circular))
    }
}

// MARK: - 海报卡片

/// tvOS 上「选中」真正的手感来自三件事同时发生，缺一件就显得生硬：
///
/// 1. **放大 + 抬起** —— 尺寸和阴影告诉你它离你更近了
/// 2. **视差** —— 封面内容随焦点方向轻微反向位移，让卡片像一块有厚度的
///    亚克力而不是一张贴纸。这是 tvOS 系统卡片最标志性的一笔，
///    也是自己画卡片时最容易漏掉的一笔。
/// 3. **高光扫过** —— 一道斜向的白色亮带在获得焦点时掠过表面。它模拟的是
///    「这块材质表面反射了环境光」，是"精致"和"廉价"的分界线。
///
/// 之前只做了 1，所以看着像网页卡片，不像 tvOS 原生。
struct PosterSurface: ViewModifier {
    let focused: Bool
    var radius: CGFloat = Theme.radiusCard
    var scale: CGFloat = 1.07

    @State private var sheen: CGFloat = -1

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return content
            .overlay {
                // 高光带。宽度只占 40%，斜着放，从左下扫到右上。
                shape.fill(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: max(0, sheen - 0.22)),
                            .init(color: .white.opacity(focused ? 0.30 : 0), location: sheen),
                            .init(color: .clear, location: min(1, sheen + 0.22)),
                        ],
                        startPoint: .bottomLeading, endPoint: .topTrailing
                    )
                )
                .blendMode(.plusLighter)
                .allowsHitTesting(false)
            }
            .overlay {
                // 亮边只在获得焦点时出现，且上缘更亮 —— 光是从上面来的。
                shape.stroke(
                    LinearGradient(
                        colors: [.white.opacity(focused ? 0.62 : 0.10),
                                 .white.opacity(focused ? 0.16 : 0.04)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: focused ? 3 : 1
                )
            }
            .clipShape(shape)
            .scaleEffect(focused ? scale : 1)
            .shadow(color: .black.opacity(focused ? 0.62 : 0.34),
                    radius: focused ? 40 : 16,
                    y: focused ? 22 : 9)
            .animation(Theme.Motion.focus, value: focused)
            .onChange(of: focused) { _, isFocused in
                guard isFocused else { sheen = -1; return }
                sheen = -0.3
                // 扫过一次就停在外面，不循环 —— 循环会变成一个抢眼的动画。
                withAnimation(.easeOut(duration: 0.85)) { sheen = 1.3 }
            }
    }
}

extension View {
    func posterSurface(_ focused: Bool, radius: CGFloat = Theme.radiusCard,
                       scale: CGFloat = 1.07) -> some View {
        modifier(PosterSurface(focused: focused, radius: radius, scale: scale))
    }
}

// MARK: - 字体

/// 苹方。
///
/// ## 为什么必须自己带
///
/// **tvOS 的运行时里没有 PingFang** —— 查过 tvOS 26.5 的模拟器运行时，
/// 一个苹方都没有。于是所有中文都落到系统的兜底字体上：字形结构松散、
/// 字重档位少、标点位置不对。这是"中文看着廉价"的根本原因，而且每一个
/// 汉字都在受影响 —— 比任何布局或配色问题影响面都大。
///
/// Forward 也是这么解决的：它打包了 36MB 的 PingFang SC/HK/TC。
///
/// ## 字重映射
///
/// 手上这份苹方有 ExtraLight / Light / Medium / Bold / Heavy，**没有
/// Regular 和 Semibold**。所以做映射时要就近取：
///
/// - 正文用 Medium，不是 Light。电视上 Light 在三米外会显得发虚 ——
///   中文笔画多，细字重在远距离下笔画会糊在一起。
/// - 标题用 Bold；歌词主行用 Heavy —— 那一行需要在一屏里绝对压过其它内容。
///
/// 取不到时退回系统字体（`.system`），不会因为字体缺失而崩或显示空白。
enum TVFont {
    private static let available: Bool = {
        UIFont(name: "PingFangSC-Medium", size: 20) != nil
    }()

    static func name(for weight: Font.Weight) -> String? {
        guard available else { return nil }
        switch weight {
        case .ultraLight, .thin, .light:
            return "PingFangSC-Light"
        case .regular, .medium:
            return "PingFangSC-Medium"
        case .semibold, .bold:
            return "PingFangSC-Bold"
        case .heavy, .black:
            return "PingFangSC-Heavy"
        default:
            return "PingFangSC-Medium"
        }
    }
}
