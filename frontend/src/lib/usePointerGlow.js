/**
 * 把指针位置写成 CSS 变量（--px / --py，0 到 1 的比例）。
 *
 * 四个刻意的取舍：
 *
 * 1. **不用 React state。** 指针移动每秒几十次，走 state 就是每秒几十次
 *    重渲染，整棵子树跟着重算 —— 光晕的代价会比光晕本身大得多。
 *    这里直接写 style，绕过 React 的渲染。
 *
 * 2. **rAF 节流。** pointermove 的触发频率跟着鼠标采样率走（高刷鼠标能到
 *    1000Hz），一帧内写多次 CSS 变量是纯浪费。每帧只写最后一次。
 *
 * 3. **只在真有指针的设备上挂。** 触屏上 pointermove 只在手指按下时才有，
 *    光晕会跟着手指跑一下然后停在那儿，比没有更怪。
 *
 * 4. **用回调 ref，不用 useRef 加空依赖的 useEffect。**
 *    挂载那一刻目标可能还不存在 —— 首页那块 hero 写在
 *    `heroAlbum ? <Section/> : ...` 里，首屏曲库还没拉回来，它不渲染。
 *    空依赖的 effect 只在挂载时跑一次，那时拿到的是 null，直接 return，
 *    之后节点出现也不会再跑。表现出来就是"类名在、光晕会亮、但永远停在
 *    正中不跟随" —— 排查时很容易误判成 ref 转发的问题，实际是时机问题。
 *    回调 ref 在节点真正接上和摘下时都会被调用，这才是对的时机。
 *
 * 用比例而不是像素：元素尺寸变了不需要重算，CSS 那边
 * calc(var(--px) * 100%) 自己会跟上。
 */

import { useCallback, useRef } from "react";

export function usePointerGlow() {
  const cleanupRef = useRef(null);

  return useCallback((node) => {
    // 先摘掉上一个节点的监听，切换目标时不泄漏。
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!node) return;
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
      return;
    }

    let frame = 0;
    let pending = null;

    const flush = () => {
      frame = 0;
      if (!pending) return;
      node.style.setProperty("--px", pending.x.toFixed(4));
      node.style.setProperty("--py", pending.y.toFixed(4));
      pending = null;
    };

    const onMove = (event) => {
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) return;
      pending = {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      };
      if (!frame) frame = requestAnimationFrame(flush);
    };

    // 指针离开时把光晕收回正中，免得下次进来时它还挂在上次的角上。
    const onLeave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      node.style.setProperty("--px", "0.5");
      node.style.setProperty("--py", "0.5");
    };

    node.addEventListener("pointermove", onMove, { passive: true });
    node.addEventListener("pointerleave", onLeave, { passive: true });
    cleanupRef.current = () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, []);
}
