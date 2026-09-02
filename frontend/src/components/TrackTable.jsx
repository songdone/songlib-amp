/**
 * 曲目表。
 *
 * 重构掉的：
 * - 每首歌用 <Music2 /> 同一个图标占位。整屏几十个一样的音符图标，
 *   既没有信息量又抢视线。现在用真实封面，没有封面就是首字占位（见 Cover）。
 * - 时长在这里手算 mm:ss。lib/format 已经有 formatTime()，两处各写一遍迟早会不一致。
 *
 * 表头和数据行必须共用同一套列宽，所以列定义只写在 CSS 里，
 * JSX 两处都不带内联宽度。
 */

import { Cover } from "./ui/Cover";
import { formatTime } from "../lib/format";
import { coverUrlFor } from "../lib/media";

export function TrackTable({ items, play }) {
  return (
    <div className="track-table">
      <div className="track-table__head">
        <span>#</span>
        <span>标题</span>
        <span>歌手</span>
        <span>专辑</span>
        <span>时长</span>
      </div>
      {items.map((item, index) => (
        <button
          type="button"
          className="track-table__row"
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
          <span className="track-table__index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="track-table__title">
            <Cover
              src={coverUrlFor(item)}
              title={item.title}
              size="32px"
              shape="square"
            />
            <b>{item.title}</b>
          </span>
          <span>{item.grandparentTitle || item.originalTitle || "—"}</span>
          <span>{item.parentTitle || "—"}</span>
          <span className="track-table__time">
            {item.duration ? formatTime(item.duration / 1000) : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}
