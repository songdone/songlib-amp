/**
 * 按钮。全站唯一的按钮实现。
 *
 * 重构前的问题：同一优先级出现了四种外观（金色实心、深色描边、幽灵、
 * 金调深底）；对齐靠各页面自己写 CSS，选择器和标记对不上就会散架
 * （例如 .task-summary > div 选中的是 div，实际渲染的是 button，
 * 整套网格从未生效，图标和文字挤在一行）。
 *
 * 这里把对齐做进组件本身：flex + 居中 + 固定图标尺寸，
 * 调用方不需要、也不应该再为对齐写 CSS。
 */

import { forwardRef } from "react";

const VARIANTS = new Set(["primary", "secondary", "ghost", "danger", "quiet"]);
const SIZES = new Set(["sm", "md", "lg"]);

/**
 * @param variant  primary 页面主操作，一屏最多一个
 *                 secondary 并列的次要操作
 *                 ghost 低干扰操作（工具栏、卡片角上）
 *                 danger 破坏性操作
 *                 quiet 只有文字、没有容器的行内操作
 * @param icon     前导图标组件（lucide），由组件统一控制尺寸
 * @param trailing 尾随图标组件，用于"展开""前往"这类方向暗示
 * @param loading  忙碌态。会同时禁用交互并向读屏播报
 */
export const Button = forwardRef(function Button(
  {
    variant = "secondary",
    size = "md",
    icon: Icon,
    trailing: Trailing,
    loading = false,
    block = false,
    pill = false,
    disabled = false,
    className = "",
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const safeVariant = VARIANTS.has(variant) ? variant : "secondary";
  const safeSize = SIZES.has(size) ? size : "md";
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "ui-btn",
        `ui-btn--${safeVariant}`,
        `ui-btn--${safeSize}`,
        block && "ui-btn--block",
        pill && "ui-btn--pill",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <span className="ui-btn__spinner" aria-hidden="true" />
      ) : (
        Icon && <Icon className="ui-btn__icon" aria-hidden="true" />
      )}
      {children != null && children !== "" && (
        <span className="ui-btn__label">{children}</span>
      )}
      {Trailing && !loading && (
        <Trailing className="ui-btn__icon ui-btn__icon--trailing" aria-hidden="true" />
      )}
    </button>
  );
});

/**
 * 纯图标按钮。
 *
 * `label` 是必填的：没有可见文字时，读屏和悬停提示都只能靠它。
 * 重构前有一批 icon-button 只有 title 没有 aria-label，
 * 读屏会念成"按钮"。
 */
export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    variant = "ghost",
    size = "md",
    loading = false,
    disabled = false,
    className = "",
    type = "button",
    ...rest
  },
  ref,
) {
  if (!label) {
    throw new Error("IconButton 必须提供 label，否则读屏用户无法知道它做什么");
  }
  const safeVariant = VARIANTS.has(variant) ? variant : "ghost";
  const safeSize = SIZES.has(size) ? size : "md";

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "ui-btn",
        "ui-btn--icon",
        `ui-btn--${safeVariant}`,
        `ui-btn--${safeSize}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <span className="ui-btn__spinner" aria-hidden="true" />
      ) : (
        <Icon className="ui-btn__icon" aria-hidden="true" />
      )}
    </button>
  );
});

/**
 * 一组按钮。负责它们之间的间距，避免每处都写 gap。
 * `align` 决定整组靠哪边，用于对话框底部或卡片操作区。
 */
export function ButtonGroup({ align = "start", wrap = false, children }) {
  return (
    <div
      className={[
        "ui-btn-group",
        `ui-btn-group--${align}`,
        wrap && "ui-btn-group--wrap",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
