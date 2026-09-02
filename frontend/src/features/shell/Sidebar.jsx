import { LogOut, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { BRAND } from "../../config/brand";
import { activeNavId, nav } from "../../lib/nav-model";
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
  const groups = [...new Set(visibleNav.map((item) => item.group))];
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button mobile-only" onClick={close}>
            <X />
          </button>
        </div>
        <nav aria-label="主导航">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {visibleNav
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    className={highlighted === item.id ? "active" : ""}
                    onClick={() => {
                      onChange(item.id);
                      close();
                    }}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {highlighted === item.id && <i />}
                  </button>
                ))}
            </div>
          ))}
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
      {open && <button className="backdrop mobile-only" onClick={close} />}
    </>
  );
}
