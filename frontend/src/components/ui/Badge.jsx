/**
 * 徽章与状态指示。
 *
 * `LiveBadge` 是带呼吸点和文字流光的胶囊，用在需要"这件事正在发生"的
 * 场合：正在扫描、正在下载、有设备在放歌。
 * 流光是环境动效，周期给到 4.8s —— 快了会一直抢注意力。
 *
 * 不要用它做静态标签。静态标签用 `Badge`。
 */

const TONES = new Set(["neutral", "accent", "success", "warning", "danger", "info"]);

/** 静态标签。表达分类或状态，不动。 */
export function Badge({ tone = "neutral", icon: Icon, children }) {
  const safeTone = TONES.has(tone) ? tone : "neutral";
  return (
    <span className={`ui-badge ui-badge--${safeTone}`}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * 正在进行的状态。
 * @param shine 是否给文字加流光。默认开；同屏出现多个时建议只留一个开。
 */
export function LiveBadge({ children, shine = true }) {
  return (
    <span className="ui-badge-live">
      <span className="pulse-dot" aria-hidden="true" />
      <span className={shine ? "text-shine" : undefined}>{children}</span>
    </span>
  );
}

/**
 * 播放中指示：三根跳动的竖条，替代"正在播放"四个字。
 * 暂停时定格而不是消失 —— 消失会让人以为这一行不再是当前曲目。
 */
export function PlayingBars({ paused = false, label = "正在播放" }) {
  return (
    <span
      className="playing-bars"
      data-paused={paused ? "true" : undefined}
      role="img"
      aria-label={paused ? "已暂停" : label}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * 从标记向外扩散的同心环。
 * 放在一个 position:relative 的容器里，会自动铺满并居中。
 */
export function Halo() {
  return (
    <span className="halo" aria-hidden="true">
      <span className="halo__ring" />
      <span className="halo__ring" />
      <span className="halo__ring" />
    </span>
  );
}
