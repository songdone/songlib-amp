import { managementNav, nav } from "../../lib/nav-model";
import { mobileNavigationIds, mobileNavigationTarget } from "../../lib/navigation";

export function MobileNav({ active, change, isAdmin = true }) {
  const labels = {
    home: "首页",
    library: "曲库",
    player: "播放",
    playlists: "歌单",
    manage: "工具",
    settings: "设置",
  };
  const items = mobileNavigationIds
    .map((id) => nav.find((item) => item.id === id))
    .filter((item) => item && (!item.admin || isAdmin));
  const highlighted = mobileNavigationTarget(
    active,
    managementNav.map((item) => item.id),
  );
  return (
    <nav
      className="mobile-nav mobile-only"
      aria-label="移动端主导航"
      style={{ "--mobile-nav-count": items.length }}
    >
      {items.map((item) => (
        <button
          className={highlighted === item.id ? "active" : ""}
          onClick={() => change(item.id)}
          key={item.id}
        >
          <item.icon />
          <span>{labels[item.id]}</span>
        </button>
      ))}
    </nav>
  );
}
