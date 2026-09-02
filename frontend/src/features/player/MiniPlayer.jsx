import { ChevronRight, Heart, ListMusic, Pause, Play, Volume2, X } from "lucide-react";
import { formatTime, pct } from "../../lib/format";
import { VISUAL_FALLBACKS, coverUrlFor } from "../../lib/media";
import { sourceLabel, usePlayer } from "./PlayerProvider";

export function MiniPlayer({ openPlayer, navigate }) {
  const player = usePlayer(),
    current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current) || VISUAL_FALLBACKS.cover;
  const liked = player.isFavorite(current);
  return (
    <div className="mini-player">
      <button className="mini-cover" onClick={openPlayer}>
        <img src={cover} alt="" />
      </button>
      <div className="mini-copy">
        <strong>{current.title}</strong>
        <span>
          {current.artist || "未知歌手"} · {sourceLabel(current.sourceType)}
        </span>
      </div>
      <button
        className={`mini-like ${liked ? "active" : ""}`}
        aria-label={liked ? "取消喜欢" : "喜欢"}
        onClick={() => player.toggleFavorite(current)}
      >
        <Heart />
      </button>
      <div className="mini-controls">
        <button onClick={player.previous}>
          <ChevronRight className="prev-icon" />
        </button>
        <button onClick={player.toggle}>
          {player.isPlaying ? <Pause /> : <Play />}
        </button>
        <button onClick={player.next}>
          <ChevronRight />
        </button>
        <div className="mini-progress">
          <i
            style={{
              width: `${player.duration ? pct(player.currentTime, player.duration) : 0}%`,
            }}
          />
        </div>
        <span>
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </span>
      </div>
      <label className="mini-volume">
        <select
          value={player.quality}
          onChange={(e) => player.setQuality(e.target.value)}
        >
          <option value="original">Original</option>
          <option value="320k">320K</option>
          <option value="256k">256K</option>
          <option value="192k">192K</option>
          <option value="128k">128K</option>
        </select>
        <Volume2 />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={player.volume}
          onChange={(e) => player.setVolume(e.target.value)}
        />
      </label>
      <button
        className="icon-button"
        onClick={openPlayer}
        aria-label="打开正在播放"
        title="打开正在播放"
      >
        <ListMusic />
      </button>
      <button
        className="icon-button"
        onClick={player.clear}
        aria-label="停止播放并清空队列"
        title="停止播放并清空队列"
      >
        <X />
      </button>
    </div>
  );
}
