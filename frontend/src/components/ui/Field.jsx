/**
 * 表单控件。
 *
 * 重构前每个表单各写一套 label + input + 图标 + 错误提示的结构，
 * 于是同一种输入框在登录页、设置页、标签编辑器里各有各的高度和圆角。
 *
 * 这里统一三件事：
 *   - label 与 input 用 id 正确关联（重构前有几处只是并排放着，
 *     点标签不会聚焦到输入框，读屏也读不出这个框是干什么的）；
 *   - 错误信息用 aria-describedby 关联，并加 role="alert" 主动播报；
 *   - 前后缀图标由组件定位，不靠调用方写 padding。
 */

import { useId } from "react";

/**
 * @param label    必填。视觉上可以用 hideLabel 隐藏，但不能不写。
 * @param hint     输入前就该知道的说明（格式要求之类）
 * @param error    校验失败信息。传了会同时染红边框并播报。
 * @param leading  前导图标组件
 * @param trailing 尾随内容（例如显示/隐藏密码的按钮）
 */
export function Field({
  label,
  hint,
  error,
  hideLabel = false,
  leading: Leading,
  trailing,
  id,
  className = "",
  ...inputProps
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ");

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label
        htmlFor={fieldId}
        className={["ui-field__label", hideLabel && "visually-hidden"]
          .filter(Boolean)
          .join(" ")}
      >
        {label}
      </label>

      <div
        className={[
          "ui-field__control",
          Leading && "ui-field__control--has-leading",
          trailing && "ui-field__control--has-trailing",
          error && "ui-field__control--invalid",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {Leading && <Leading className="ui-field__icon" aria-hidden="true" />}
        <input
          id={fieldId}
          className="ui-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...inputProps}
        />
        {trailing && <span className="ui-field__trailing">{trailing}</span>}
      </div>

      {hint && !error && (
        <p id={hintId} className="ui-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** 一组表单项。负责纵向间距，调用方不写 margin。 */
export function FieldSet({ children, columns = 1, legend }) {
  return (
    <div className="ui-fieldset" style={{ "--fieldset-columns": columns }}>
      {legend && <p className="ui-fieldset__legend">{legend}</p>}
      <div className="ui-fieldset__grid">{children}</div>
    </div>
  );
}

/**
 * 整块的提示条。用于表单级错误或需要用户注意的说明。
 * tone 决定语气，但无论哪种都带 role 让读屏能收到。
 */
export function Notice({ tone = "info", icon: Icon, title, children }) {
  return (
    <div
      className={`ui-notice ui-notice--${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {Icon && <Icon className="ui-notice__icon" aria-hidden="true" />}
      <div className="ui-notice__body">
        {title && <p className="ui-notice__title">{title}</p>}
        {children && <div className="ui-notice__text">{children}</div>}
      </div>
    </div>
  );
}
