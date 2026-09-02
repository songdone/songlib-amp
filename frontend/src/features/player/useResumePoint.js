/**
 * 跨设备续播。
 *
 * 手机上听到 3:20，走到电脑前，浏览器问你要不要接着 3:20 听。
 *
 * 两条贯穿始终的规矩：
 *
 * 1. **绝不自动跳。** 服务端只负责记住位置，跳不跳是用户的决定。
 *    自动跳是那种第一次遇到会以为是 bug 的"聪明"。
 * 2. 上报要节流。timeupdate 每秒烧四次，照着发就是每秒四个请求。
 *    这里 15 秒一次，外加暂停和关页面时各补一次 —— 真正会丢的只有
 *    最后不到 15 秒。
 *
 * 关页面那一次必须用 sendBeacon：unload 之后 fetch 会被浏览器取消，
 * 而 sendBeacon 是专门为这一刻设计的，浏览器保证把它发出去。
 */

import { useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { trackIdentity } from "../../lib/media";

const REPORT_INTERVAL_MS = 15_000;

/** 这台设备的名字，用来在"继续听"里说明是从哪儿听到这儿的。 */
export function deviceLabel() {
  const agent = navigator.userAgent || "";
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return "Android 手机";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows";
  return "浏览器";
}

const payloadFor = (track, position, duration) => ({
  trackKey: trackIdentity(track),
  position: Math.round(position),
  duration: Math.round(duration || track?.duration || 0),
  title: track?.title || "",
  artist: track?.artist || track?.grandparentTitle || "",
  album: track?.album || track?.parentTitle || "",
  coverUrl: track?.albumCoverUrl || track?.coverUrl || track?.thumbUrl || "",
  device: deviceLabel(),
  // 快照。原文件之后被删掉时，"继续听"这条记录还显示得出来。
  track: {
    id: track?.id,
    ratingKey: track?.ratingKey,
    plexRatingKey: track?.plexRatingKey,
    localFileId: track?.localFileId,
    sourceType: track?.sourceType,
    canonicalKey: track?.canonicalKey,
    duration: track?.duration,
  },
});

/**
 * 定期把当前播放位置报给服务端。
 *
 * 调用方只要把"当前曲目"和一个读取实时位置的函数传进来即可 ——
 * 刻意不接收 currentTime 本身，因为那个值每秒变四次，
 * 传进来会让这个 hook 每秒重建四次定时器。
 */
export function useResumeReporter({ track, isPlaying, readPosition }) {
  const readRef = useRef(readPosition);
  readRef.current = readPosition;
  const trackRef = useRef(track);
  trackRef.current = track;

  useEffect(() => {
    if (!track || !isPlaying) return undefined;

    const report = () => {
      const current = trackRef.current;
      if (!current) return;
      const { position, duration } = readRef.current() || {};
      if (!position) return;
      api("/api/playback/position", {
        method: "PUT",
        body: JSON.stringify(payloadFor(current, position, duration)),
      }).catch(() => {
        // 续播位置丢一次没关系，不值得打扰用户。
      });
    };

    const timer = setInterval(report, REPORT_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      // 切歌或暂停时补一次，否则最后这一段永远报不上去。
      report();
    };
  }, [track && trackIdentity(track), isPlaying]);

  // 关页面 / 切后台。
  useEffect(() => {
    const flush = () => {
      const current = trackRef.current;
      if (!current) return;
      const { position, duration } = readRef.current() || {};
      if (!position) return;
      const body = JSON.stringify(payloadFor(current, position, duration));
      // sendBeacon 只能 POST，所以后端那个 PUT 这里走不了。
      // 退回 fetch + keepalive：它同样保证在页面卸载后继续发，
      // 而且能带上方法和 CSRF 头。
      try {
        api("/api/playback/position", { method: "PUT", body, keepalive: true });
      } catch {
        // 忽略：页面正在关，没有能展示错误的地方。
      }
    };
    // pagehide 比 unload 可靠：iOS Safari 上 unload 经常不触发。
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => window.removeEventListener("pagehide", flush);
  }, []);
}

/**
 * 查这首歌有没有存着的位置。
 *
 * 返回 null 表示没有或不值得续（服务端已经把开头结尾附近的过滤掉了）。
 */
export async function fetchResumePoint(track) {
  const key = trackIdentity(track);
  if (!key) return null;
  try {
    const result = await api(
      `/api/playback/position?trackKey=${encodeURIComponent(key)}`,
    );
    return result?.position ? result : null;
  } catch {
    return null;
  }
}
