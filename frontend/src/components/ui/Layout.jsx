/**
 * 页面骨架组件：页头、区块标题、列表行、空状态。
 *
 * 重构前这些结构在每个页面各写一遍，于是同一种东西有好几个样子 ——
 * 空状态标题在"正在播放"页是 44px（比页面标题还大），在别处是 16px；
 * 区块标题的"查看全部"有时是 text-button，有时是 secondary 按钮。
 *
 * 层级约定（不要打破）：
 *
 *   h1 只有一个，而且不在这里 —— 是顶栏那个页名（见 shell/Topbar）。
 *   它每页都在、每页唯一，正是这一页的名字。
 *   PageHeader 和 SectionHeader 都是 h2：PageHeader 是页首的引导块，
 *   不是各个 Section 的容器，两者是兄弟关系而不是父子关系。
 *   EmptyState 的标题永远是区块级，不参与和页面标题争大小。
 *
 * 页面正文里不要再写 <h1>。之前 PageHeader 渲染 h1，
 * 首页于是有两个 h1（顶栏"首页" + 正文"听点喜欢的"），
 * 读屏器报出来是两个页面标题。
 */

import { forwardRef } from "react";
import { useReveal } from "../../hooks/useReveal";
import { ChevronRight } from "lucide-react";
import { Button } from "./Button";

/**
 * 页头。一个页面只应有一个。
 *
 * @param eyebrow 标题上方的小字，用于分类或状态，不要放句子
 * @param title   页面标题，短名词短语
 * @param lead    一句话说明这个页面能帮用户做什么；不确定要写什么就别写
 * @param actions 页面级操作，最多两个，主操作放最后
 */
export function PageHeader({ eyebrow, title, lead, actions }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        {eyebrow && <p className="ui-page-header__eyebrow">{eyebrow}</p>}
        {/* 标题用自上而下的渐变填充，底部略淡。
            只在页面级大标题上用 —— 小字加渐变会糊。 */}
        <h2 className="ui-page-header__title text-gradient">{title}</h2>
        {lead && <p className="ui-page-header__lead">{lead}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}

/**
 * 区块标题。
 * `onMore` 传了就渲染一个统一的"查看全部"入口，不要各页面自己写。
 */
export function SectionHeader({ title, note, moreLabel = "查看全部", onMore, actions }) {
  return (
    <div className="ui-section-header">
      <div className="ui-section-header__text">
        <h2 className="ui-section-header__title">{title}</h2>
        {note && <p className="ui-section-header__note">{note}</p>}
      </div>
      {actions}
      {onMore && (
        <Button variant="quiet" trailing={ChevronRight} onClick={onMore}>
          {moreLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * 列表行。左侧视觉、中间主次文案、右侧尾随内容。
 * 传 onClick 就是可点的，会渲染成 button 并带上箭头。
 *
 * 传了 onClick 就不要往 trailing 里放按钮 —— 整行是 <button>，
 * 里面再放一个就是嵌套交互元素：HTML 无效，键盘和读屏行为都不确定。
 * 一行需要两个以上动作时，不要给行本身 onClick，把动作都放进 trailing。
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  selected = false,
  chevron = true,
}) {
  const interactive = typeof onClick === "function";
  const Element = interactive ? "button" : "div";
  return (
    <Element
      type={interactive ? "button" : undefined}
      onClick={onClick}
      aria-current={selected || undefined}
      className={[
        "ui-list-row",
        interactive && "ui-list-row--interactive",
        selected && "ui-list-row--selected",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {leading && <span className="ui-list-row__leading">{leading}</span>}
      <span className="ui-list-row__text">
        <span className="ui-list-row__title">{title}</span>
        {subtitle && <span className="ui-list-row__subtitle">{subtitle}</span>}
      </span>
      {trailing && <span className="ui-list-row__trailing">{trailing}</span>}
      {interactive && chevron && (
        <ChevronRight className="ui-list-row__chevron" aria-hidden="true" />
      )}
    </Element>
  );
}

/** 一组列表行，负责它们之间的分隔线和圆角。 */
export function ListGroup({ children }) {
  return <div className="ui-list-group">{children}</div>;
}

/**
 * 空状态。
 *
 * `action` 是关键：空状态的价值在于告诉用户下一步做什么，
 * 只写"暂无数据"等于把人堵在这里。
 */
export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="ui-empty">
      {Icon && (
        <span className="ui-empty__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <p className="ui-empty__title">{title}</p>
      {text && <p className="ui-empty__text">{text}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

/**
 * 页面主内容容器。统一水平留白与区块间距。
 *
 * 转发 ref 是为了让 useReveal 能挂上来观察内部的 .rise 元素 ——
 * 滚动入场需要一个稳定的容器节点。
 */
export const Page = forwardRef(function Page({ children, className = "" }, ref) {
  return (
    <div ref={ref} className={["ui-page", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
});

/**
 * 区块。把标题和内容绑在一起，间距由这里给。
 *
 * @param reveal 传 true 时进入视口才淡入上浮。
 *               首屏就在视野里的区块不要传 —— 那会让人看到一次多余的动画。
 *
 * 观察器挂在自己身上，不依赖上层记得调 useReveal。
 * 之前是"加上 .rise 类，等页面容器上的观察器来标记"，
 * 而 .rise 的初始状态是 opacity:0 —— 页面忘了挂 ref，
 * 整个区块就永久不可见，而且不报任何错。这种 API 迟早会出事。
 */
export function Section({ children, className = "", reveal = false }) {
  const revealRef = useReveal({ enabled: reveal });
  return (
    <section
      ref={reveal ? revealRef : undefined}
      className={["ui-section", reveal && "rise", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}
