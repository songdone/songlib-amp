/**
 * 滚动入场：元素进入视口时打上 data-revealed，配合 .rise 类做淡入上浮。
 *
 * 为什么不用纯 CSS：CSS 没有"进入视口"这个选择器（animation-timeline 的
 * 浏览器支持还不够），所以必须用 IntersectionObserver。
 *
 * 三个刻意的设计：
 *
 * 1. 只触发一次。列表来回滚动时反复淡入淡出会让人晕，
 *    而且滚回去看过的内容再动一次没有任何信息价值。
 * 2. rootMargin 底部留 -8%，让元素真正进入视野一点点才开始动，
 *    否则在屏幕边缘就播完了，用户看到的是已经结束的动画。
 * 3. 用户关闭动效或系统开启"减弱动态效果"时，直接标记为已显示，
 *    完全不创建观察器 —— 省掉一整套监听。
 */

import { useEffect, useRef } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * @param options.threshold 元素露出多少比例才算进入，默认 0.12
 * @param options.enabled   传 false 可临时关掉（例如动效强度为 0）
 * @returns ref，挂在要观察的容器上；容器内所有 .rise 子元素会被依次标记
 */
export function useReveal({ threshold = 0.12, enabled = true } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    const targets = root.matches?.(".rise")
      ? [root, ...root.querySelectorAll(".rise")]
      : [...root.querySelectorAll(".rise")];
    if (!targets.length) return undefined;

    // 关掉动效时直接落到终态，不创建观察器。
    if (!enabled || prefersReducedMotion() || !("IntersectionObserver" in window)) {
      for (const node of targets) node.dataset.revealed = "true";
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.dataset.revealed = "true";
          // 触发一次就不再观察，避免来回滚动反复播放。
          observer.unobserve(entry.target);
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );

    for (const node of targets) observer.observe(node);
    return () => observer.disconnect();
  });

  return ref;
}
