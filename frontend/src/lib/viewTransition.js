/**
 * 页面切换用 View Transitions。
 *
 * 为什么值得用：现在的切换是 CSS 的 route-in 动画 —— 新页面淡入上浮，
 * **但旧页面是瞬间消失的**。眼睛看到的是"闪一下，然后新内容浮上来"，
 * 而不是一次连续的转场。View Transitions 会给旧帧和新帧各自截图，
 * 由浏览器做交叉淡出，两边都连续。
 *
 * 三条边界：
 *
 * 1. **不支持就直接改状态。** Safari 到目前为止还没有
 *    `document.startViewTransition`。降级必须是"立刻生效"，
 *    绝不能因为 API 不在就不切页面。
 *
 * 2. **尊重减弱动态效果。** 转场也是动效。
 *
 * 3. **回调必须同步改完状态。** startViewTransition 拿到回调后会先截旧帧、
 *    执行回调、再截新帧。回调里做异步的事，第二帧就截到中间态。
 *    所以传进来的必须是 setState 这类同步操作。
 */

const reduced = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function withViewTransition(update) {
  if (typeof document.startViewTransition !== "function" || reduced()) {
    update();
    return;
  }
  document.startViewTransition(update);
}
