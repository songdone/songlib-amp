import { ChevronRight, Heart, Music2, Pause, Play } from "lucide-react";
import { formatTime, pct } from "../../lib/format";
import { VISUAL_FALLBACKS, coverUrlFor } from "../../lib/media";
import { usePlayer } from "../player/PlayerProvider";

export function SidebarMiniPlayer({ openPlayer }) {
  const player = usePlayer();
  const current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current) || VISUAL_FALLBACKS.cover;
  const title = current.title || "未命名歌曲";
  const artist = current.artist || "未知歌手";
  const progress = player.duration
    ? pct(player.currentTime, player.duration)
    : 0;
  const liked = player.isFavorite(current);
  return (
    <section className="sidebar-player" aria-label="侧边栏迷你播放器">
      <div className="sidebar-player-head">
        <button className="sidebar-player-cover" onClick={openPlayer}>
          {cover ? <img src={cover} alt="" /> : <Music2 />}
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
