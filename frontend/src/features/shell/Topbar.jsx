import { Activity, ChevronDown, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import { useState } from "react";
import { BRAND } from "../../config/brand";

export function Topbar({ title, subtitle, openMenu, onNavigate, logout, profile }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const submitSearch = (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    onNavigate("search");
  };
  return (
    <header className="topbar">
      <button className="icon-button mobile-only" onClick={openMenu}>
        <Menu />
      </button>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="top-actions">
        <form className="top-search" onSubmit={submitSearch}>
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(e);
            }}
            placeholder="搜索音乐、艺术家、专辑…"
          />
          <kbd>↵</kbd>
        </form>
        <div
          className="brand-status"
          title={`${BRAND.fullName} · 音屿正在本地运行`}
          role="status"
          aria-label="音屿正在本地运行"
        >
          <img src={BRAND.mark} alt="" />
          <span />
        </div>
        <button
          className="icon-button notification"
          onClick={() => onNavigate("tasks")}
        >
          <Activity />
          <span />
        </button>
        <div className="user-entry">
          <button
            className="avatar"
            onClick={() => setOpen(!open)}
            aria-label="用户菜单"
          >
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              <UserRound />
            )}
            <ChevronDown />
          </button>
          {open && (
            <div className="user-menu panel">
              <strong>{profile?.displayName || "音屿控制台"}</strong>
              <button
                onClick={() => {
                  onNavigate("settings");
                  setOpen(false);
                }}
              >
                <UserRound />
                账号设置
              </button>
              <button
                onClick={() => {
                  onNavigate("settings");
                  setOpen(false);
                }}
              >
                <Settings />
                系统设置
              </button>
              <button onClick={logout}>
                <LogOut />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
