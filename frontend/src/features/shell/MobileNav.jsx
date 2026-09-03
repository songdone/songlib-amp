/**
 * 移动端底部导航。
 *
 * 五格：首页 / 曲库 / 播放 / 歌单 / 更多。
 * "更多"不是一个真实页面，而是通往整理曲库（管理员）或设置（听众）的入口 ——
 * 手机底栏放不下九个目的地，硬塞会让每格窄到点不准。
 *
 * 高亮由 mobileNavigationTarget 统一裁决，保证任何时刻只有一格亮。
 * 重构前这里会同时高亮"播放""工具""设置"三格。
 */

import { Ellipsis } from "lucide-react";
import { useCallback } from "react";
import { managementNav, nav } from "../../lib/nav-model";
import {
  mobileMoreTarget,
  mobileNavigationIds,
  mobileNavigationLabels,
  mobileNavigationTarget,
} from "../../lib/navigation";

export function MobileNav({ active, change, isAdmin = true }) {
  /*
   * 把底栏的**真实**高度写成 CSS 变量，给迷你播放条和页面留白用。
   *
   * 为什么不写死：底栏高度是 calc(64px + env(safe-area-inset-bottom))，
   * 而迷你条那边写死了 bottom:78px —— 而且写死的那条在 legacy.protected 层，
   * 无视特异性压过了带安全区的版本。真 iPhone 上安全区 34px，底栏变成 98px，
   * 迷你条底边还停在 78px，正好压住底栏 20px。用户报的"遮住底栏"就是这个。
   * 无头浏览器安全区是 0，所以本地永远量不出来。
   *
   * 用回调 ref 而不是 useRef + useEffect：这个组件是条件渲染的
   * （isMobile && <MobileNav/>），空依赖的 effect 在节点还不存在时就跑完了，
   * 之后节点出现也不会再跑。这个坑仓库里踩过。
   */
  const measure = useCallback((node) => {
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty("--mobile-nav-height", "0px");
      return;
    }
    const publish = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) {
        root.style.setProperty("--mobile-nav-height", `${height}px`);
      }
    };
    publish();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(publish);
      observer.observe(node);
      // 回调 ref 拿不到 cleanup，把断开挂在节点上，节点消失时一起走。
      node.__slNavObserver?.disconnect();
      node.__slNavObserver = observer;
    }
  }, []);

  const highlighted = mobileNavigationTarget(
    active,
    managementNav.map((item) => item.id),
  );

  const items = mobileNavigationIds.map((id) => {
    if (id === "more") {
      return { id, icon: Ellipsis, target: mobileMoreTarget(isAdmin) };
    }
    const entry = nav.find((item) => item.id === id);
    return entry ? { id, icon: entry.icon, target: id } : null;
  });

  const visible = items.filter(Boolean);

  return (
    <nav
      ref={measure}
      className="mobile-nav mobile-only"
      aria-label="主导航"
      style={{ "--mobile-nav-count": visible.length }}
    >
      {visible.map((item) => {
        const current = highlighted === item.id;
        return (
          <button
            key={item.id}
            className={current ? "active" : ""}
            aria-current={current ? "page" : undefined}
            onClick={() => change(item.target)}
          >
            <item.icon aria-hidden="true" />
            <span>{mobileNavigationLabels[item.id]}</span>
          </button>
        );
      })}
    </nav>
  );
}
