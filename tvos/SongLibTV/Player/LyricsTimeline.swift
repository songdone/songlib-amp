import Foundation

/// 一首歌的歌词时间轴，以及"此刻该高亮哪一行"。
///
/// 两个设计问题是真实素材逼出来的，不是想出来的 —— 拿这个库里的
/// 《一万小时》做样本时直接撞上：
///
/// 1. **开头四行是制作名单**，时间戳分别在 0、1、2、3 秒。照着时间轴渲染的
///    结果是开头四秒里字幕疯狂闪四下 —— 正是上一版投屏被吐槽的"歌词自己
///    在跳"那个观感。所以名单从滚动时间轴里摘出来，在前奏里安静地显示一次。
///
/// 2. **有空文本的行**（这首在 10.09s→33.36s 有一条）是 Plex 表达间奏的方式。
///    照字面渲染就是一大片空白挂 23 秒，用户会以为程序卡死了。所以空行不算
///    歌词，算间奏，交给界面画个呼吸指示。
struct LyricsTimeline {
    struct Line: Identifiable, Hashable {
        let start: Double
        let end: Double?
        let text: String
        var id: String { "\(start)-\(text)" }

        var isBlank: Bool { text.isEmpty }
    }

    /// 参与滚动的歌词行（已剔除空行和开头的制作名单）。
    let lines: [Line]
    /// 开头那段制作名单，原样保留，供界面在前奏里显示。
    let credits: [String]
    let isTimed: Bool

    init(lines rawLines: [Line], isTimed: Bool) {
        self.isTimed = isTimed
        let sorted = rawLines.sorted { $0.start < $1.start }

        // 只摘**开头连续的**那几行名单。歌词正文里偶然出现一个冒号
        // （"他说 : 别回头"）不该被当成名单删掉。
        var creditTexts: [String] = []
        var index = 0
        while index < sorted.count {
            let line = sorted[index]
            if line.isBlank {
                index += 1
                continue
            }
            guard Self.looksLikeCredit(line.text) else { break }
            creditTexts.append(line.text)
            index += 1
        }
        self.credits = creditTexts
        self.lines = sorted[index...].filter { !$0.isBlank }
    }

    /// 常见的制作名单前缀。中文库里冒号前后有没有空格都见过，
    /// 所以匹配的是"冒号之前那截"。
    private static let creditRoles = [
        "作词", "作曲", "编曲", "监制", "制作人", "出品", "发行", "混音",
        "母带", "和声", "录音", "吉他", "贝斯", "鼓", "键盘", "弦乐",
        "词", "曲", "演唱", "原唱", "OP", "SP",
        "lyrics", "composer", "arranger", "producer", "mixing", "mastering",
    ]

    static func looksLikeCredit(_ text: String) -> Bool {
        guard let separator = text.firstIndex(where: { $0 == ":" || $0 == "：" }) else {
            return false
        }
        let role = text[text.startIndex..<separator]
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        guard !role.isEmpty, role.count <= 12 else { return false }
        return creditRoles.contains { role == $0.lowercased() || role.hasPrefix($0.lowercased()) }
    }

    var isEmpty: Bool { lines.isEmpty }

    /// 此刻高亮第几行。返回 nil 表示现在没有该唱的词 —— 前奏、间奏或者尾奏。
    ///
    /// 判定用的是"上一行有没有唱完"，而不是"下一行有没有开始"：只看下一行的
    /// 开始时间的话，一段 23 秒的间奏会表现成上一句在屏幕上干挂 23 秒。
    func activeIndex(at time: Double) -> Int? {
        guard !lines.isEmpty else { return nil }
        guard let candidate = lines.lastIndex(where: { $0.start <= time }) else {
            return nil  // 还没到第一句，前奏
        }
        let line = lines[candidate]
        if let end = line.end, time > end {
            // 这句唱完了。下一句还没到就是间奏。
            let next = candidate + 1
            if next < lines.count, lines[next].start > time { return nil }
            if next >= lines.count { return nil }  // 尾奏
        }
        return candidate
    }

    /// 距离下一句还有多久。界面用它决定间奏指示要不要显示。
    func secondsUntilNextLine(at time: Double) -> Double? {
        guard let next = lines.first(where: { $0.start > time }) else { return nil }
        return next.start - time
    }
}
