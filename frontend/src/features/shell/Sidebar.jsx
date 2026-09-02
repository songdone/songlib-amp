/**
 * 侧边导航。
 *
 * 分组来自 lib/nav-model 的 NAV_GROUPS，"设置"不属于任何分组，
 * 单独排在导航末尾 —— 它是低频系统配置，不是一类日常任务。
 */

import { LogOut, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { IconButton } from "../../components/ui/Button";
import { BRAND } from "../../config/brand";
import { NAV_GROUPS, activeNavId, nav } from "../../lib/nav-model";
import { SidebarMiniPlayer } from "./SidebarMiniPlayer";

export function Sidebar({
  active,
  onChange,
  open,
  close,
  logout,
  version,
  openPlayer,
  isAdmin = true,
}) {
  const visibleNav = nav.filter((item) => !item.admin || isAdmin);
  const highlighted = activeNavId(active);

  const go = (id) => {
    onChange(id);
    close();
  };

  const renderItem = (item) => {
    const current = highlighted === item.id;
    return (
      <button
        key={item.id}
        className={current ? "active" : ""}
        aria-current={current ? "page" : undefined}
        onClick={() => go(item.id)}
      >
        <item.icon />
        <span>{item.label}</span>
        {current && <i aria-hidden="true" />}
      </button>
    );
  };

  // 只渲染真的有可见项的分组，避免非管理员看到一个空的"整理曲库"标题。
  const groups = Object.entries(NAV_GROUPS).filter(([key]) =>
    visibleNav.some((item) => item.group === key),
  );
  const ungrouped = visibleNav.filter((item) => !item.group);

  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <IconButton
            icon={X}
            label="收起导航"
            className="mobile-only"
            onClick={close}
          />
        </div>

        <nav aria-label="主导航">
          {groups.map(([key, label]) => (
            <div className="nav-group" key={key}>
              <span className="nav-group-label">{label}</span>
              {visibleNav.filter((item) => item.group === key).map(renderItem)}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="nav-group">{ungrouped.map(renderItem)}</div>
          )}
        </nav>

        <div className="sidebar-footer">
          <SidebarMiniPlayer openPlayer={openPlayer} />
          <div className="side-version">v{version || BRAND.version}</div>
          <button className="logout" onClick={logout}>
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      </aside>
      {open && (
        /* 点遮罩关侧栏。一个没有内容的 <button /> 在无障碍树里是匿名按钮，
           读屏器只会念"按钮"，不知道点了会发生什么。 */
        <button
          type="button"
          className="backdrop mobile-only"
          aria-label="关闭导航"
          onClick={close}
        />
      )}
    </>
  );
}
