/**
 * 声波地平线：登录页和空状态的氛围背景。
 *
 * 旧登录页用的是一张金色粒子波形位图。位图的问题是它固定分辨率、
 * 固定配色，换主题就不对了，而且在 4K 屏上会糊。
 * 这里用一排会缓慢起伏的竖条重画，好处是：
 *   - 颜色取自 --accent-solid，跟着主题走；
 *   - 任何分辨率都清晰，体积几乎为零；
 *   - 只动 transform，不掉帧。
 *
 * 高度序列是确定性的（由下标算出），不是随机 —— 每次刷新形状一致，
 * 不会让人觉得页面在闪。
 */

const BAR_COUNT = 72;

/**
 * 用两个不同周期的正弦叠加，得到既有起伏又不规则重复的轮廓。
 * 纯函数，同一个下标永远得到同一个高度。
 */
const heightAt = (index, total) => {
  const t = index / total;
  const wave =
    Math.sin(t * Math.PI * 6) * 0.34 +
    Math.sin(t * Math.PI * 13 + 1.3) * 0.2 +
    Math.sin(t * Math.PI * 2.2) * 0.28;
  // 映射到 12%~100%，两端自然收窄，中间最高。
  const envelope = Math.sin(t * Math.PI) ** 0.7;
  return Math.max(0.12, (0.5 + wave * 0.5) * envelope);
};

/**
 * @param bars    竖条数量。窄屏可以传小一点省节点。
 * @param animate 关掉后保持静态形状，用于对动效敏感的场合。
 */
export function SoundField({ bars = BAR_COUNT, animate = true }) {
  return (
    <div
      className={`sound-field ${animate ? "sound-field--animate" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          style={{
            "--bar-height": `${heightAt(index, bars) * 100}%`,
            // 相邻条错开相位，形成从左往右推进的波，而不是整排一起跳。
            "--bar-delay": `${(index % 12) * -180}ms`,
          }}
        />
      ))}
    </div>
  );
}
