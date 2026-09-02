/**
 * 文件路径。
 *
 * 路径在列表里放不下时，要省略**开头**而不是结尾 —— 有用的信息
 * （文件名）在末尾，省略末尾等于把唯一有用的部分省掉了。
 *
 * CSS 只有一个办法做到这件事：`direction: rtl`。它让溢出发生在左边，
 * 省略号出现在开头。但它有个代价，而且这个代价已经在项目里出过错：
 *
 * 双向文本算法会把**首尾的中性字符**（/ - . _ 空格）搬到另一端。
 * 于是 `/music/五月天/07 - 突然好想你.flac` 会渲染成
 * `music/五月天/07 - 突然好想你.flac/` —— 开头那个斜杠跑到了末尾。
 * 下载入库、体检、整理目录三处都有这个毛病，都是同一个原因。
 *
 * 修法是在两端各加一个 U+200E（LEFT-TO-RIGHT MARK）。它是强 LTR 字符，
 * 把中性字符夹在中间，双向算法就不会再把它们移出去。
 * 这个字符不占宽度、不可见、也不会被复制进剪贴板之外的地方。
 *
 * 所以这件事只在这里做一次，别再在各自的 CSS 里写 direction: rtl。
 */

const LRM = "‎";

/**
 * @param path  要显示的路径
 * @param clip  "start" 省略开头（默认，适合长路径）
 *              "end"   省略结尾（路径已经很短、或本身就只有文件名时用）
 */
export function PathText({ path, clip = "start", className = "", title }) {
  const text = String(path || "");
  return (
    <code
      className={["ui-path", `ui-path--clip-${clip}`, className]
        .filter(Boolean)
        .join(" ")}
      // 悬停能看到完整路径。这里给的是没有 LRM 的原文。
      title={title ?? text}
      dir={clip === "start" ? "rtl" : "ltr"}
    >
      {clip === "start" ? `${LRM}${text}${LRM}` : text}
    </code>
  );
}
