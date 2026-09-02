import { fmt } from "../lib/format";

export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "amber",
  progress,
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{fmt(value)}</strong>
        <small>{detail}</small>
      </div>
      {progress !== undefined && (
        <div className="mini-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </article>
  );
}
