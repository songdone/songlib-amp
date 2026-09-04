import SwiftUI

/// 大屏上的排版和配色。
///
/// 电视有两件事跟手机完全不同，这里的每个数值都是为它们定的：
///
/// 1. **观看距离是三米，不是三十厘米。** 手机上舒服的字号在电视上是一片
///    蚂蚁。所以正文起步 34pt，歌词主行 62pt —— 按 1920×1080 的点阵算，
///    这相当于手机上的超大号标题。
/// 2. **画面会被投在一面很大的、通常很暗的墙上。** 纯黑底配纯白字在电视
///    上会晃眼，边缘还会渗光。所以底色是带一点暖调的近黑，最亮的字也压在
///    纯白之下。
enum Theme {
    // 底色不用 #000：纯黑在 OLED 上和面板熄灭的区域无法区分，画面边界会消失，
    // 而在 LCD 上又会因为背光漏光显出一块块不均匀的灰。近黑两边都稳。
    static let canvas = Color(red: 0.043, green: 0.039, blue: 0.047)

    static let lyricActive = Color(red: 1.0, green: 0.99, blue: 0.97)
    static let lyricNear = Color.white.opacity(0.46)
    static let lyricFar = Color.white.opacity(0.20)

    static let textPrimary = Color.white.opacity(0.94)
    static let textSecondary = Color.white.opacity(0.62)
    static let textTertiary = Color.white.opacity(0.38)

    /// 歌词字号。
    ///
    /// 主行和邻行拉开到 62 / 40 是刻意的：电视上没有鼠标指针，也没有滚动条，
    /// 「现在唱到哪儿」只能靠字号和亮度的对比说话。差得太小，隔三米看就分不出
    /// 哪行是当前行 —— 前一版投屏的截图上就是这个毛病。
    static let lyricActiveSize: CGFloat = 62
    static let lyricIdleSize: CGFloat = 40
    /// 行距按字号走，不写死。字号一改行距就跟着走，不会散架。
    static let lyricLineSpacing: CGFloat = 26

    static let screenPadding: CGFloat = 90
    static let cornerRadius: CGFloat = 18
}

extension Font {
    static func lyric(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight)
    }
}
