/**
 * 顶栏。
 *
 * 重构前右上角那排图标是歪的，原因有三个：
 *   1. 尺寸不统一 —— .icon-button 是 38px，.avatar 是 38px 但内部布局不同，
 *      brand-status 又是另一套尺寸，三者基线对不齐；
 *   2. 头像按钮里塞了两个图标（UserRound + ChevronDown）却没做对齐，
 *      一个居中一个贴边；
 *   3. brand-status 是个装饰性的"正在本地运行"徽章，只增加视觉噪音。
 *
 * 现在整排都用同一个 IconButton（同尺寸、同对齐、强制带无障碍标签），
 * 头像单独一个组件，去掉装饰徽章。
 *
 * 并补上深浅色快速切换 —— 原先只能进设置里翻三层才能换主题。
 */

import {
  Activity,
  ChevronDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui/Button";

/** 主题按钮的三态循环：跟随系统 → 深色 → 浅色 → 跟随系统。 */
const THEME_CYCLE = [
  { id: "system", icon: Monitor, label: "主题：跟随系统，点击切到深色" },
  { id: "dark", icon: Moon, label: "主题：深色，点击切到浅色" },
  { id: "light", icon: Sun, label: "主题：浅色，点击切回跟随系统" },
];

export function Topbar({
  title,
  subtitle,
  openMenu,
  onNavigate,
  logout,
  profile,
  themePreference = "dark",
  onThemeChange,
  hasTaskActivity = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef(null);

  // 点外面关掉用户菜单。原先只能再点一次头像才关，
  // 点页面别处菜单会一直挂着。
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submitSearch = (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    onNavigate("search");
  };

  const themeIndex = Math.max(
    0,
    THEME_CYCLE.findIndex((item) => item.id === themePreference),
  );
  const currentTheme = THEME_CYCLE[themeIndex];
  const nextTheme = THEME_CYCLE[(themeIndex + 1) % THEME_CYCLE.length];

  return (
    <header className="topbar">
      <IconButton
        icon={Menu}
        label="打开导航"
        className="mobile-only"
        onClick={openMenu}
      />

      {/* 顶栏标题就是页面标题，所以用 h1。
          页面正文里不再重复一次页名。 */}
      <div className="topbar__heading">
        <h1 className="topbar__title">{title}</h1>
        {subtitle && <p className="topbar__subtitle">{subtitle}</p>}
      </div>

      <div className="topbar__actions">
        <form className="top-search" onSubmit={submitSearch}>
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索音乐、艺术家、专辑…"
            aria-label="搜索音乐、艺术家、专辑"
          />
          <kbd aria-hidden="true">↵</kbd>
        </form>

        {/* 深浅色快速切换。图标显示的是**当前**状态，
            aria-label 说明点下去会变成什么 —— 只写"切换主题"
            的话用户不知道会切到哪一档。 */}
        <IconButton
          icon={currentTheme.icon}
          label={currentTheme.label}
          onClick={() => onThemeChange?.(nextTheme.id)}
        />

        <IconButton
          icon={Activity}
          label={hasTaskActivity ? "任务（有正在进行的）" : "任务"}
          className={hasTaskActivity ? "topbar__tasks topbar__tasks--live" : "topbar__tasks"}
          onClick={() => onNavigate("tasks")}
        />

        <div className="topbar__user" ref={menuRef}>
          <button
            type="button"
            className="topbar__avatar"
            aria-label="用户菜单"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((value) => !value)}
          >
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              <UserRound aria-hidden="true" />
            )}
            <ChevronDown className="topbar__avatar-caret" aria-hidden="true" />
          </button>

          {open && (
            <div className="topbar__menu glass glass--thick" role="menu">
              <p className="topbar__menu-name">
                {profile?.displayName || profile?.username || "未命名用户"}
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onNavigate("me");
                  setOpen(false);
                }}
              >
                <UserRound aria-hidden="true" />
                我的收藏与历史
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onNavigate("settings");
                  setOpen(false);
                }}
              >
                <Settings aria-hidden="true" />
                设置
              </button>
              <button type="button" role="menuitem" onClick={logout}>
                <LogOut aria-hidden="true" />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
