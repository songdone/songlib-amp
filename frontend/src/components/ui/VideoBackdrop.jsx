/**
 * 循环视频背景。
 *
 * 背景：1.0.4 版本把登录页的大型背景视频移除了，CHANGELOG 写的原因是
 * "iPad 登录页移除运行时动画依赖、大型背景视频和持续粒子动画" ——
 * 原文件 1280×720 只有 10 秒，码率却高达 9.7 Mbps，足足 11.7 MB，
 * 在低性能 iPad 上会和前端初始化抢资源，启动时黑屏。
 *
 * 现在把视频加回来，但不能把当初修掉的问题一起带回来。四道闸：
 *
 *   1. 重新编码到 0.5 MB（H.264）/ 0.44 MB（VP9），比原来小 23 倍。
 *      同样的画面，码率降下来而已 —— 慢速暗色素材本来就不需要那么高。
 *   2. 海报图先渲染，视频等浏览器空闲时才开始加载。
 *      首屏永远不等视频，登录表单立刻可用。
 *   3. 标签页切到后台就暂停，切回来再播。
 *      持续解码是当初拖慢设备的真正原因，不是文件大小。
 *   4. 用户开了"减弱动态效果"或系统省流量模式时，只显示海报图，
 *      完全不请求视频。
 *
 * 任何一道闸没过，界面都还是完整的 —— 海报图本身就是一张成立的背景。
 */

import { useEffect, useRef, useState } from "react";

/** 用户或系统是否明确表示不想要动态效果 / 不想耗流量。 */
const shouldSkipVideo = () => {
  if (typeof window === "undefined") return true;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData) return true;
  // 2G/3G 下 0.5 MB 也是负担，退回海报图。
  if (/(^|-)2g$/.test(connection?.effectiveType || "")) return true;
  return false;
};

/** 空闲时再做，拿不到 requestIdleCallback 就退回一个短延时。 */
const onIdle = (callback) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(callback, 600);
  return () => window.clearTimeout(timer);
};

/**
 * @param sources 按优先级排列的视频源。浏览器挑第一个支持的。
 * @param poster  海报图。必须提供 —— 它是视频没加载时的完整兜底。
 * @param alt     海报图的替代文字。纯装饰传空字符串。
 */
export function VideoBackdrop({ sources = [], poster, alt = "" }) {
  const videoRef = useRef(null);
  const [showVideo, setShowVideo] = useState(false);
  const [ready, setReady] = useState(false);

  // 闸 2 + 闸 4：空闲时再决定要不要加载。
  useEffect(() => {
    if (shouldSkipVideo() || !sources.length) return undefined;
    return onIdle(() => setShowVideo(true));
  }, [sources.length]);

  // 闸 3：页面不可见时暂停，避免后台持续解码。
  useEffect(() => {
    if (!showVideo) return undefined;
    const sync = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [showVideo]);

  return (
    <div className="video-backdrop" aria-hidden={alt ? undefined : "true"}>
      <img
        src={poster}
        alt={alt}
        className="video-backdrop__poster"
        data-hidden={ready ? "true" : undefined}
      />
      {showVideo && (
        <video
          ref={videoRef}
          className="video-backdrop__video"
          data-ready={ready ? "true" : undefined}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          // 只有真正开始播放才淡入，避免出现一帧黑屏。
          onPlaying={() => setReady(true)}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      )}
    </div>
  );
}
