import { ChevronRight, Heart, ListMusic, Pause, Play, Volume2, X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { formatTime, pct } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { sourceLabel, usePlayer } from "./PlayerProvider";

export function MiniPlayer({ openPlayer, navigate }) {
  const player = usePlayer(),
    current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current);
  const liked = player.isFavorite(current);
  return (
    <div className="mini-player">
      <button
        type="button"
        className="mini-cover"
        aria-label="打开正在播放"
        onClick={openPlayer}
      >
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
        <button type="button" aria-label="上一首" onClick={player.previous}>
          <ChevronRight className="prev-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={player.isPlaying ? "暂停" : "播放"}
          onClick={player.toggle}
        >
          {player.isPlaying ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </button>
        <button type="button" aria-label="下一首" onClick={player.next}>
          <ChevronRight aria-hidden="true" />
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
      {/* 这两个在窄屏要藏起来（迷你条上放不下）。
          旧规则是 commercial.css 的 `.mini-player > .icon-button{display:none}`，
          类名一换就失配，所以同一条规则在 player.css 里按新类名重写了一份。 */}
      <IconButton
        icon={ListMusic}
        size="sm"
        label="打开正在播放"
        onClick={openPlayer}
      />
      <IconButton
        icon={X}
        size="sm"
        label="停止播放并清空队列"
        onClick={player.clear}
      />
    </div>
  );
}
