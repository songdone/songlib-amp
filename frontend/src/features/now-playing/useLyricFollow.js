/**
 * 让歌词跟着歌走。
 *
 * 之前全站没有一处 scrollIntoView：歌词列表渲染完就摆在那儿，
 * 歌唱到第 30 句，可视区里还是第 1 到第 8 句。用户只能自己滚，
 * 而且滚到哪儿就停在哪儿，跟播放进度毫无关系。
 *
 * 三条规矩：
 *
 * 1. **把当前句放到容器正中**，不是 scrollIntoView 的"刚好进入可视区"。
 *    歌词看的是上下文，当前句贴着边缘时看不到下一句。
 *
 * 2. **用户一动手就让开。** 手动滚动之后 PAUSE_MS 内不自动跟，
 *    否则用户想往前翻两句会被立刻拽回来 —— 那种"抢鼠标"的感觉
 *    比不跟随更糟。
 *
 * 3. 只有真的换行了才滚。当前句每秒被重算一次，值没变就不动，
 *    否则平滑滚动会被每秒一次的新目标打断成抽搐。
 */

import { useEffect, useRef } from "react";

const PAUSE_MS = 2600;

export function useLyricFollow(containerRef, activeIndex, enabled = true) {
  const pausedUntil = useRef(0);
  const lastIndex = useRef(-1);

  // 记下用户最后一次手动滚动的时间。wheel / touchmove 才算手动，
  // scroll 事件不行 —— 我们自己的平滑滚动也会触发 scroll，
  // 用它判断会导致跟随一启动就把自己判成"用户在滚"。
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const touched = () => {
      pausedUntil.current = Date.now() + PAUSE_MS;
    };
    node.addEventListener("wheel", touched, { passive: true });
    node.addEventListener("touchmove", touched, { passive: true });
    return () => {
      node.removeEventListener("wheel", touched);
      node.removeEventListener("touchmove", touched);
    };
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) return;
    const node = containerRef.current;
    if (!node || activeIndex < 0) return;
    if (activeIndex === lastIndex.current) return;
    lastIndex.current = activeIndex;
    if (Date.now() < pausedUntil.current) return;

    const line = node.children[activeIndex];
    if (!line) return;
    // 目标：当前句的中心对齐容器的中心。
    const target =
      line.offsetTop - node.clientHeight / 2 + line.offsetHeight / 2;
    const top = Math.max(0, Math.min(target, node.scrollHeight - node.clientHeight));
    // 差得不多就不动，省掉一堆几像素的抖动。
    if (Math.abs(node.scrollTop - top) < 4) return;
    node.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [containerRef, activeIndex, enabled]);
}
