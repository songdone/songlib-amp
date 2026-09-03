/**
 * 打开覆盖层时锁住底层滚动。
 *
 * 全屏歌词原来是个普通 `<section position:fixed>`，既没锁滚动也没让底层
 * 失去交互 —— 覆盖层开着的时候滚轮滚的是后面那一页，能透过半透明蒙层
 * 看见底下在动。原生 `<dialog>.showModal()` 会让背景 inert，但**不会**
 * 阻止页面滚动，所以 Modal 也需要这一层。
 *
 * 两件事必须一起做，只做 overflow:hidden 会让页面横跳一下：
 * 滚动条消失，可用宽度突然变宽。所以同时补一块等宽的右内边距。
 *
 * 支持嵌套：用计数器，最后一个关掉才恢复。中间那层关掉就恢复的话，
 * 弹窗里再开弹窗、关掉内层，外层就漏了。
 */

import { useEffect } from "react";

let depth = 0;
let saved = null;

function lock() {
  depth += 1;
  if (depth > 1) return;
  const { body } = document;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  saved = { overflow: body.style.overflow, paddingInlineEnd: body.style.paddingInlineEnd };
  body.style.overflow = "hidden";
  if (gap > 0) body.style.paddingInlineEnd = `${gap}px`;
}

function unlock() {
  depth = Math.max(0, depth - 1);
  if (depth > 0 || !saved) return;
  document.body.style.overflow = saved.overflow;
  document.body.style.paddingInlineEnd = saved.paddingInlineEnd;
  saved = null;
}

/** @param active true 时锁住；组件卸载会自动解锁，不会漏。 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    lock();
    return unlock;
  }, [active]);
}
