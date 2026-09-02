import { Music2 } from "lucide-react";

export function TrackTable({ items, play }) {
  return (
    <div className="track-table panel">
      <div className="track-head">
        <span>#</span>
        <span>标题</span>
        <span>歌手</span>
        <span>专辑</span>
        <span>时长</span>
      </div>
      {items.map((item, index) => (
        <button
          className="track-row track-button"
          key={item.ratingKey}
          onClick={() =>
            play?.(
              { ...item, source: "plex_item" },
              items
                .slice(index + 1)
                .map((track) => ({ ...track, source: "plex_item" })),
            )
          }
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span className="track-title">
            <div>
              <Music2 />
            </div>
            <b>{item.title}</b>
          </span>
          <span>{item.grandparentTitle || item.originalTitle || "—"}</span>
          <span>{item.parentTitle || "—"}</span>
          <span>
            {item.duration
              ? `${Math.floor(item.duration / 60000)}:${String(Math.floor(item.duration / 1000) % 60).padStart(2, "0")}`
              : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}
