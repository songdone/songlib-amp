/**
 * 统计磁贴。数字 + 说明 + 可选图标，可作为筛选器点击。
 *
 * 替换重构前的 .task-summary 与 .stat-card。
 * 那两处的问题是布局写在 CSS 里、且选择器和标记对不上
 * （.task-summary > div 选中 div，实际渲染的是 button），
 * 于是网格从未生效，图标、数字、说明全挤在一行。
 *
 * 这里布局做进组件：图标独占一列并纵向居中，数字和说明各占一行。
 * 无论渲染成 div 还是 button，结构都一样。
 */

import { fmt } from "../../lib/format";

const TONES = new Set(["neutral", "accent", "success", "warning", "danger", "info"]);

/**
 * @param value    数字。会走 fmt 做千分位，传字符串则原样显示。
 * @param label    说明文字，一句话说清这个数字是什么。
 * @param onClick  传了就渲染成可点击的筛选器，并用 aria-pressed 表达选中态。
 * @param selected 仅在可点击时有意义。
 */
export function StatTile({
  icon: Icon,
  value,
  label,
  detail,
  tone = "neutral",
  onClick,
  selected = false,
}) {
  const safeTone = TONES.has(tone) ? tone : "neutral";
  const interactive = typeof onClick === "function";
  const Element = interactive ? "button" : "div";

  return (
    <Element
      type={interactive ? "button" : undefined}
      onClick={onClick}
      aria-pressed={interactive ? selected : undefined}
      className={[
        "ui-stat",
        `ui-stat--${safeTone}`,
        interactive && "ui-stat--interactive",
        selected && "ui-stat--selected",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon && (
        <span className="ui-stat__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <span className="ui-stat__body">
        <span className="ui-stat__value">
          {typeof value === "number" ? fmt(value) : value}
        </span>
        <span className="ui-stat__label">{label}</span>
        {detail && <span className="ui-stat__detail">{detail}</span>}
      </span>
    </Element>
  );
}

/** 统计磁贴的自适应网格。列数按可用宽度定，不写死断点。 */
export function StatGrid({ children }) {
  return <div className="ui-stat-grid">{children}</div>;
}
