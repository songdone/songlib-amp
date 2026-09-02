/**
 * 批量操作的公共骨架：选范围 → 逐条核对 → 确认执行。
 *
 * 抽出来的原因：这套流程现在有三处 —— 封面与歌词、补标签、整理目录。
 * 三处都在改用户文件，都必须先把"现在是什么、要变成什么"摆出来，
 * 界面结构没有理由各写一遍。
 *
 * 一条铁律写在这里，不要在调用处破例：
 *   不会被执行的条目（skip）不给勾选框。
 *   给一个能勾的框，会让人以为勾上就能强制执行。
 */

import { ArrowRight } from "lucide-react";
import { Badge } from "./Badge";

/**
 * 单选胶囊组。
 *
 * @param options `{ id, label, note }[]`；带 note 的渲染成两行
 * @param value   当前选中的 id
 */
export function ChipGroup({ label, options, value, onChange, columns = false }) {
  return (
    <div
      className={columns ? "ui-chips ui-chips--cards" : "ui-chips"}
      role="group"
      aria-label={label}
    >
      {options.map((item) => {
        const on = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            className={`ui-chip${on ? " ui-chip--on" : ""}`}
            onClick={() => onChange(item.id)}
          >
            <strong>{item.label}</strong>
            {item.note && <small>{item.note}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** 变更清单容器。负责行与行之间的分隔。 */
export function ChangeList({ children }) {
  return <ul className="ui-plan-list">{children}</ul>;
}

/**
 * 一条变更。
 *
 * @param target     改的是谁（歌曲名、文件路径）
 * @param badges     `{ label, tone }[]`，用来标字段名、冲突、跳过
 * @param oldValue   现在的值；空字符串会显示成"（空）"
 * @param newValue   要写入的值；传 React 节点可以放缩略图
 * @param meta       右侧的次要信息，如来源和匹配度
 * @param skipped    true 时不给勾选框，只显示 reason
 */
export function ChangeRow({
  target,
  badges = [],
  oldValue,
  newValue,
  meta = [],
  skipped = false,
  skipReason,
  checked = true,
  onToggle,
  toggleLabel,
}) {
  const off = !checked || skipped;
  return (
    <li className={`ui-plan-row${off ? " ui-plan-row--off" : ""}`}>
      {skipped || !onToggle ? (
        <span className="ui-plan-row__nocheck" aria-hidden="true" />
      ) : (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={toggleLabel || `应用对「${target}」的修改`}
        />
      )}

      <span className="ui-plan-row__main">
        <span className="ui-plan-row__head">
          <strong>{target}</strong>
          {badges.map((badge, index) => (
            <Badge key={`${badge.label}-${index}`} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </span>

        {skipped ? (
          <small className="ui-plan-row__note">{skipReason}</small>
        ) : (
          <span className="ui-plan-diff">
            {/* 空值显示"（空）"而不是留白 —— 留白会让人以为界面没加载出来。 */}
            <span className="ui-plan-diff__old">{oldValue || "（空）"}</span>
            <ArrowRight aria-hidden="true" />
            <span className="ui-plan-diff__new">{newValue}</span>
          </span>
        )}
      </span>

      {meta.length > 0 && (
        <span className="ui-plan-row__meta">
          {meta.map((text, index) => (
            <small key={index}>{text}</small>
          ))}
        </span>
      )}
    </li>
  );
}

/**
 * 底部确认条。
 *
 * summary 必须写清"会发生什么"和"多少条"，不要只写"确认执行"。
 * 用户在这里做的是不可逆的决定，摘要就是他唯一的依据。
 */
export function ConfirmBar({ summary, detail, children }) {
  return (
    <div className="ui-plan-confirm">
      <div className="ui-plan-confirm__text">
        {summary && <strong>{summary}</strong>}
        {detail && <span>{detail}</span>}
      </div>
      {children}
    </div>
  );
}
