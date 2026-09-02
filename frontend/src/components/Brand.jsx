import { BRAND } from "../config/brand";

export function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <img className="brand-mark" src={BRAND.mark} alt="" />
      {!compact && (
        <div>
          <b>{BRAND.sidebarTitle}</b>
          <small>{BRAND.sidebarSlogan}</small>
        </div>
      )}
    </div>
  );
}
