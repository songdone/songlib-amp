import { ChevronRight, Heart, Pause, Play } from "lucide-react";
import { Cover } from "../../components/ui/Cover";
import { formatTime, pct } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { usePlayer } from "../player/PlayerProvider";

export function SidebarMiniPlayer({ openPlayer }) {
  const player = usePlayer();
  const current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current);
  const title = current.title || "未命名歌曲";
  const artist = current.artist || "未知歌手";
  const progress = player.duration
    ? pct(player.currentTime, player.duration)
    : 0;
  const liked = player.isFavorite(current);
  return (
    <section className="sidebar-player" aria-label="侧边栏迷你播放器">
      <div className="sidebar-player-head">
        {/* 缺封面时由 Cover 给出按标题生成的安静占位，
            不再铺那张带 "SONGLIB AMP" 水印的兜底图。 */}
        <button
          type="button"
          className="sidebar-player-cover"
          aria-label="打开正在播放"
          onClick={openPlayer}
        >
          <Cover src={cover} title={current.title} shape="square" />
        </button>
        <div>
          <strong>{title}</strong>
          <span>{artist}</span>
        </div>
        <button
          className={`sidebar-like ${liked ? "active" : ""}`}
          aria-label={liked ? "取消喜欢" : "喜欢"}
          onClick={() => player.toggleFavorite(current)}
        >
          <Heart />
        </button>
      </div>
      <div className="sidebar-player-controls">
        <button onClick={player.previous} aria-label="上一首">
          <ChevronRight className="prev-icon" />
        </button>
        <button
          className="sidebar-play"
          onClick={player.toggle}
          aria-label={player.isPlaying ? "暂停" : "播放"}
        >
          {player.isPlaying ? <Pause /> : <Play />}
        </button>
        <button onClick={player.next} aria-label="下一首">
          <ChevronRight />
        </button>
      </div>
      <div className="sidebar-player-progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="sidebar-player-time">
        <span>{formatTime(player.currentTime)}</span>
        <span>{formatTime(player.duration)}</span>
      </div>
    </section>
  );
}
