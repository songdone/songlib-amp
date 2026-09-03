import { ChevronDown, ChevronRight, ChevronUp, Heart, ListMusic, Pause, Play, Volume2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { formatTime, pct } from "../../lib/format";
import { coverUrlFor } from "../../lib/media";
import { storedJson } from "../../lib/storage";
import { sourceLabel, usePlayer } from "./PlayerProvider";

const COLLAPSED_KEY = "songlib-mini-collapsed";

export function MiniPlayer({ openPlayer, navigate }) {
  const player = usePlayer(),
    current = player.currentTrack;
  /*
   * 收起状态。之前迷你条只有"停止播放并清空队列"那个 X ——
   * 想让它别挡路就只能把歌关掉，等于没得选。收起后只剩封面和播放键
   * 贴在右下角，歌还在放。记在本机，刷新后保持。
   *
   * hook 必须写在 `if (!current) return null` 之前 —— 提前 return 之后
   * 再调 hook，首屏没歌时不执行、有歌时多出来，直接 React #310 白屏。
   * 这个上过线（1.1.3）。
   */
  const [collapsed, setCollapsed] = useState(() =>
    Boolean(storedJson(COLLAPSED_KEY, false)),
  );
  const toggleCollapsed = () =>
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* 隐身模式写不进去，不影响本次 */
      }
      return next;
    });
  /* 迷你条自己的真实高度也发布出去，页面底部留白按它算。
     回调 ref：这个组件是条件渲染的（showMiniPlayer && <MiniPlayer/>）。 */
  const measure = useCallback((node) => {
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty("--mini-player-height", "0px");
      return;
    }
    const publish = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--mini-player-height", `${height}px`);
    };
    publish();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(publish);
      observer.observe(node);
      node.__slMiniObserver?.disconnect();
      node.__slMiniObserver = observer;
    }
  }, []);
  if (!current) return null;
  const cover = coverUrlFor(current);
  const liked = player.isFavorite(current);
  return (
    <div
      ref={measure}
      className={`mini-player${collapsed ? " mini-player--collapsed" : ""}`}
    >
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
      {/* 收起键只在窄屏出现（见 player.css）。宽屏迷你条不挡任何东西。 */}
      <button
        type="button"
        className="mini-collapse"
        aria-label={collapsed ? "展开播放条" : "收起播放条"}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        {collapsed ? (
          <ChevronUp aria-hidden="true" />
        ) : (
          <ChevronDown aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
