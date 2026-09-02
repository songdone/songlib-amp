/**
 * 对话框。
 *
 * 用原生 <dialog>，而不是自己拿 div 加 z-index 堆一个。
 * 原生元素免费给到四件事，自己实现每一件都容易漏：
 *   - 焦点陷阱（Tab 不会跑到背后的页面上）
 *   - Esc 关闭
 *   - ::backdrop 伪元素，不用额外遮罩节点
 *   - 顶层渲染，不受父元素 overflow / transform 影响
 *
 * 重构前的弹窗是 div + position:fixed，键盘能 Tab 到背后的表单里，
 * 而且在有 transform 的祖先下会被裁掉。
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";

const SIZES = new Set(["sm", "md", "lg", "xl"]);

/**
 * @param open      是否打开
 * @param onClose   关闭回调。Esc 和点击遮罩都会触发。
 * @param title     标题。必填 —— 读屏靠它知道打开了什么。
 * @param size      sm 确认框 / md 表单 / lg 多栏表单 / xl 编辑器
 * @param dismissible 点遮罩是否关闭。有未保存内容时传 false。
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  dismissible = true,
  children,
}) {
  const ref = useRef(null);
  const safeSize = SIZES.has(size) ? size : "md";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // 原生 cancel 事件对应 Esc。拦下来交给上层管状态，
  // 否则 dialog 自己关了但 React 还以为是开着的。
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCancel = (event) => {
      event.preventDefault();
      onClose?.();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`ui-modal ui-modal--${safeSize}`}
      aria-label={title}
      onClick={(event) => {
        // 只有点在 dialog 本身（即遮罩区域）才关闭，
        // 点内容区不关 —— 内容区是子元素，event.target 会是它。
        if (dismissible && event.target === ref.current) onClose?.();
      }}
    >
      <div className="ui-modal__panel glass glass--thick">
        <header className="ui-modal__head">
          <div className="ui-modal__head-text">
            <h2 className="ui-modal__title">{title}</h2>
            {description && <p className="ui-modal__desc">{description}</p>}
          </div>
          <IconButton icon={X} label="关闭" onClick={onClose} />
        </header>
        <div className="ui-modal__body">{children}</div>
      </div>
    </dialog>
  );
}
