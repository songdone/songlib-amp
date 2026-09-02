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
import { managementNav, nav } from "../../lib/nav-model";
import {
  mobileMoreTarget,
  mobileNavigationIds,
  mobileNavigationLabels,
  mobileNavigationTarget,
} from "../../lib/navigation";

export function MobileNav({ active, change, isAdmin = true }) {
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
