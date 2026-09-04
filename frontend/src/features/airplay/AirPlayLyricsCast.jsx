import { useCallback, useEffect, useRef, useState } from "react";
import { Airplay } from "lucide-react";

import { api } from "../../lib/api";
import {
  airPlayLiveLatencyMs,
  airPlayStatePayload,
  airPlayTrackId,
  nativeAirPlayAvailable,
  primeAirPlayVideo,
  airPlayVideoIsLive,
} from "../../lib/airplay";

export function useAirPlayLyricsCast({ track, lyrics, player }) {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const creatingRef = useRef(null);
  const syncingRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncMetadataQueuedRef = useRef(false);
  const pickerTimerRef = useRef(null);
  // 见 showPicker：playing 之后补一次选择器，这两个 ref 是给那段用的。
  const pickerRetryRef = useRef(null);
  const pickerOpenRef = useRef(false);
  /* 路由建好、视频让出音频会话之后，通知外面把音乐接着放。 */
  const onAudioSessionReleasedRef = useRef(null);
  const routeGuardUntilRef = useRef(0);
  const resumeTimerRef = useRef(null);
  const remoteActionRef = useRef({ action: "", at: 0 });
  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState(null);
  const [engaged, setEngaged] = useState(false);
  const [wireless, setWireless] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availability, setAvailability] = useState("unknown");
  const [message, setMessage] = useState("");
  const [transportLatencyMs, setTransportLatencyMs] = useState(0);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(() => {
    const saved = Number(window.localStorage.getItem("songlib-airplay-lyrics-offset") || 0);
    return Number.isFinite(saved) ? Math.max(-5000, Math.min(5000, saved)) : 0;
  });
  const hasTrack = Boolean(track);
  pickerOpenRef.current = pickerOpen;
  const playerRef = useRef(player);
  const wirelessRef = useRef(false);

  playerRef.current = player;
  latestPayloadRef.current = airPlayStatePayload({
    track,
    lyrics,
    player,
    lyricsOffsetMs,
    transportLatencyMs,
  });

  const runRemoteAction = useCallback((action, details = {}) => {
    const now = Date.now();
    if (now - remoteActionRef.current.at < 600) return;
    remoteActionRef.current = { action, at: now };
    const current = playerRef.current;
    if (!current) return;
    if (action === "toggle") {
      if (current.isPlaying) {
        if (typeof current.pause === "function") current.pause();
        else current.toggle?.();
      } else if (typeof current.play === "function") current.play();
      else current.toggle?.();
      return;
    }
    if (action === "play") {
      if (typeof current.play === "function") current.play();
      else if (!current.isPlaying) current.toggle?.();
      return;
    }
    if (action === "pause") {
      if (typeof current.pause === "function") current.pause();
      else if (current.isPlaying) current.toggle?.();
      return;
    }
    if (action === "previous") return current.previous?.();
    if (action === "next") return current.next?.();
    if (action === "seek") return current.seek?.(Number(details.position || 0));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const available = nativeAirPlayAvailable(video);
    setSupported(available);
    if (!video || !available) return undefined;
    const onAvailability = (event) =>
      setAvailability(event.availability || "unknown");
    const onWirelessChange = () => {
      const active = Boolean(video.webkitCurrentPlaybackTargetIsWireless);
      wirelessRef.current = active;
      routeGuardUntilRef.current = Date.now() + 1800;
      setPickerOpen(false);
      if (active && pickerTimerRef.current) {
        window.clearTimeout(pickerTimerRef.current);
        pickerTimerRef.current = null;
      }
      setWireless(active);
      setEngaged(active);
      video.classList.toggle("is-active", active);
      setMessage(
        active
          ? "已连上 Apple TV，切歌不用重连"
          : "",
      );
      if (active) {
        /*
         * 路由已经建立 —— 立刻把视频静音，**把音频会话还给音乐**。
         *
         * 不静音只在"抢路由"那一刻需要：WebKit 要看到一个完整的音视频
         * 会话才肯把 AirPlay 绑给这个 <video>，而不是绑到音频上。
         * 但如果一直不静音，它就一直占着 iOS/Safari 的音频会话，
         * 把本地播放器的音乐挤停 —— 用户实测过：
         * "能投上屏、歌词在大屏上跳动，但歌没在放"。
         *
         * 反正这条流的音轨本来就是数字静音（-91 dB），静音不影响电视上
         * 看到的画面，只是让出音频会话。路由不会因为静音而断开。
         */
        video.muted = true;
        video.play().catch(() => {
          setMessage("已选中 Apple TV 但视频未送出，重开设备选择器");
        });
        onAudioSessionReleasedRef.current?.();
      } else {
        video.pause();
        video.removeAttribute("src");
        video.preload = "none";
        video.load();
      }
    };
    const onPause = () => {
      if (
        !wirelessRef.current ||
        !video.webkitCurrentPlaybackTargetIsWireless
      ) return;

      // The lyrics HLS is a continuous transport. Pausing it freezes the live
      // playlist and eventually disconnects Apple TV, so resume it immediately.
      // A deliberate Siri Remote play/pause press is treated as a toggle for the
      // selected audio player after the route-settling guard has elapsed.
      if (Date.now() >= routeGuardUntilRef.current) {
        runRemoteAction("toggle");
      }
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        resumeTimerRef.current = null;
        if (
          wirelessRef.current &&
          video.webkitCurrentPlaybackTargetIsWireless &&
          video.paused
        ) video.play().catch(() => {});
      }, 80);
    };
    const onWaiting = () => {
      if (wirelessRef.current) setMessage("Apple TV 正在追赶直播边缘…");
    };
    const onPlaying = () => {
      if (wirelessRef.current) setMessage("Apple TV 歌词视频已连接；切歌无需重连");
    };
    const onError = () => {
      // A source is attached only while the native picker is open or a TV route
      // is active. Avoid depending on pickerOpen here: re-subscribing the whole
      // media effect would cancel the picker's 30-second cleanup timer.
      if (!wirelessRef.current && !video.currentSrc && !video.src) return;
      const code = Number(video.error?.code || 0);
      setMessage(
        code
          ? `视频加载失败（错误码 ${code}）。重新投一次。`
          : "歌词视频流加载失败，请重新投屏",
      );
    };
    video.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      onAvailability,
    );
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    video.addEventListener(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWirelessChange,
    );
    return () => {
      if (pickerTimerRef.current) window.clearTimeout(pickerTimerRef.current);
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      video.removeEventListener(
        "webkitplaybacktargetavailabilitychanged",
        onAvailability,
      );
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      video.removeEventListener(
        "webkitcurrentplaybacktargetiswirelesschanged",
        onWirelessChange,
      );
    };
  }, [hasTrack, runRemoteAction]);

  const prepare = useCallback(async () => {
    if (!supported || !hasTrack) return null;
    if (sessionRef.current) return sessionRef.current;
    if (!creatingRef.current) {
      creatingRef.current = api("/api/airplay/cast", {
        method: "POST",
        body: JSON.stringify({}),
      })
        .then(async (created) => {
          sessionRef.current = created;
          setSession(created);
          const updated = await api(`/api/airplay/cast/${created.sessionId}`, {
            method: "PATCH",
            body: JSON.stringify(latestPayloadRef.current),
          });
          sessionRef.current = updated;
          setSession(updated);
          return updated;
        })
        .catch((error) => {
          setMessage(error.message || "无法准备投屏视频流");
          throw error;
        })
        .finally(() => {
          creatingRef.current = null;
        });
    }
    return creatingRef.current;
  }, [supported, hasTrack]);

  useEffect(() => {
    if (!supported || !hasTrack || sessionRef.current) return;
    prepare().catch(() => {});
  }, [supported, hasTrack, prepare]);

  const sync = useCallback(async (metadata = false) => {
    if (syncingRef.current) {
      syncQueuedRef.current = true;
      if (metadata) syncMetadataQueuedRef.current = true;
      return;
    }
    syncingRef.current = true;
    let metadataRequested = metadata;
    try {
      do {
        const sendMetadata =
          metadataRequested || syncMetadataQueuedRef.current;
        metadataRequested = false;
        syncQueuedRef.current = false;
        syncMetadataQueuedRef.current = false;
        const currentSession = sessionRef.current;
        const payload = latestPayloadRef.current;
        if (!currentSession?.sessionId || !payload?.trackId) return;
        const body = sendMetadata
          ? payload
          : {
              position: payload.position,
              duration: payload.duration,
              playing: payload.playing,
              lyricsOffsetMs: payload.lyricsOffsetMs,
              transportLatencyMs: payload.transportLatencyMs,
            };
        const updated = await api(
          `/api/airplay/cast/${currentSession.sessionId}${sendMetadata ? "" : "/clock"}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
        );
        sessionRef.current = { ...currentSession, ...updated };
        setSession((value) => ({ ...value, ...updated }));
        if (updated.status === "error")
          setMessage(updated.error || "歌词视频流异常");
      } while (syncQueuedRef.current);
    } catch (error) {
      setMessage(error.message || "歌词投屏时钟同步失败");
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const payloadSnapshot = latestPayloadRef.current;
  const metadataKey = [
    airPlayTrackId(track),
    payloadSnapshot?.title,
    payloadSnapshot?.artist,
    payloadSnapshot?.album,
    payloadSnapshot?.coverKey,
    player.quality,
  ].join("|");
  useEffect(() => {
    if (!session?.sessionId) return;
    sync(true);
  }, [session?.sessionId, metadataKey, lyrics, sync]);

  useEffect(() => {
    if (!session?.sessionId) return;
    sync(false);
  }, [session?.sessionId, lyricsOffsetMs, transportLatencyMs, sync]);

  useEffect(() => {
    if (!session?.sessionId || !engaged) return undefined;
    const timer = window.setInterval(() => sync(false), 1000);
    return () => window.clearInterval(timer);
  }, [session?.sessionId, engaged, sync]);

  useEffect(() => {
    if (!wireless) {
      setTransportLatencyMs(0);
      return undefined;
    }
    const sample = () => {
      const measured = airPlayLiveLatencyMs(videoRef.current);
      if (!measured) return;
      setTransportLatencyMs((current) => {
        const next = current
          ? Math.round((current * 0.7 + measured * 0.3) / 50) * 50
          : measured;
        return Math.abs(next - current) >= 100 ? next : current;
      });
    };
    sample();
    const timer = window.setInterval(sample, 1000);
    return () => window.clearInterval(timer);
  }, [wireless]);

  useEffect(() => {
    window.localStorage.setItem("songlib-airplay-lyrics-offset", String(lyricsOffsetMs));
  }, [lyricsOffsetMs]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!engaged || !mediaSession) return undefined;
    const actions = {
      play: () => runRemoteAction("play"),
      pause: () => runRemoteAction("pause"),
      previoustrack: () => runRemoteAction("previous"),
      nexttrack: () => runRemoteAction("next"),
      seekto: (details) => {
        if (Number.isFinite(details?.seekTime))
          runRemoteAction("seek", { position: details.seekTime });
      },
      seekbackward: (details) => {
        const current = playerRef.current;
        runRemoteAction("seek", {
          position: Math.max(
            0,
            Number(current?.currentTime || 0) - Number(details?.seekOffset || 10),
          ),
        });
      },
      seekforward: (details) => {
        const current = playerRef.current;
        const duration = Math.max(0, Number(current?.duration || 0));
        runRemoteAction("seek", {
          position: Math.min(
            duration || Infinity,
            Number(current?.currentTime || 0) + Number(details?.seekOffset || 10),
          ),
        });
      },
    };
    try {
      // Do not advertise a second audio Now Playing session. The Apple TV must
      // render the HLS video rather than falling back to artwork metadata.
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
    } catch {}
    for (const [action, handler] of Object.entries(actions)) {
      try { mediaSession.setActionHandler(action, handler); } catch {}
    }
    return () => {
      for (const action of Object.keys(actions)) {
        try { mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, [engaged, runRemoteAction]);

  const adjustLyricsOffset = useCallback((delta) => {
    setLyricsOffsetMs((current) =>
      Math.max(-5000, Math.min(5000, current + Number(delta || 0))),
    );
  }, []);

  /*
   * 在用户点下去之前就把视频喂起来。
   *
   * pointerdown 比 click 早几十到几百毫秒 —— 对 HLS 起播来说不算多，
   * 但足以让 <video> 从"什么都没有"变成"已经在拉流"。
   * 这一步是为了让设备选择器打开时，已经有一个**正在播放的视频会话**
   * 可以绑；否则 WebKit 会退回到音频/Now Playing 会话，电视上就是
   * "封面 + 歌名"的标准音频投屏画面（用户拍照实证过）。
   */
  const primeForPicker = useCallback(() => {
    const video = videoRef.current;
    const ready = sessionRef.current;
    if (!video || !ready || !nativeAirPlayAvailable(video)) return;
    if (airPlayVideoIsLive(video)) return;
    primeAirPlayVideo(video, ready.streamUrl).catch(() => {});
  }, []);

  const showPicker = useCallback(async () => {
    const video = videoRef.current;
    if (!nativeAirPlayAvailable(video)) {
      setMessage(
        "这个浏览器没有 AirPlay 接口（那是 Safari 独有的）。请在 iPhone、iPad 或 Mac 的 Safari 里打开本页再投。",
      );
      return;
    }
    const ready = sessionRef.current;
    if (!ready) {
      setMessage("投屏地址准备中，稍后再点「投到电视」");
      try {
        await prepare();
      } catch {}
      return;
    }
    setPickerOpen(true);
    setMessage(
      "在弹出的列表里选你的 Apple TV。注意：要从这里投，别用 Plexamp 或控制中心的投屏 —— 那两个只投音频，电视上只会显示封面。",
    );
    try {
      // Safari may suspend media that is effectively hidden or outside the
      // viewport. Make the real HLS video visibly present before asking WebKit
      // for a route, so the picker is bound to a playing video session instead
      // of falling back to the browser's audio/Now Playing session.
      // This call remains inside the user's click gesture. It starts the HLS
      // request before the native picker opens, allowing Safari to identify the
      // source as H.264 video with a silent AAC compatibility track.
      primeAirPlayVideo(video, ready.streamUrl).catch(() => {
        if (!wirelessRef.current) {
          setMessage("视频未开始传输，检查 Apple TV 能否访问这台 NAS");
        }
      });
      /*
       * 视频真的开始播之后再补一次选择器。
       *
       * 第一次调用是在用户手势里，必须调 —— 但那一刻视频往往还没解出第一帧，
       * WebKit 手里没有"正在播放的视频会话"可绑。等 playing 事件到了再补一次，
       * 这时绑的一定是视频。已经投上了（wireless）就不补，免得又弹一次框。
       */
      pickerRetryRef.current?.();
      const retry = () => {
        video.removeEventListener("playing", retry);
        pickerRetryRef.current = null;
        if (wirelessRef.current || !pickerOpenRef.current) return;
        try {
          video.webkitShowPlaybackTargetPicker();
        } catch {
          /* 手势之外可能被拒，拒了就算了 —— 第一次那下还在 */
        }
      };
      pickerRetryRef.current = () => video.removeEventListener("playing", retry);
      video.addEventListener("playing", retry, { once: true });
      video.webkitShowPlaybackTargetPicker();
      if (pickerTimerRef.current) window.clearTimeout(pickerTimerRef.current);
      pickerTimerRef.current = window.setTimeout(() => {
        if (!video.webkitCurrentPlaybackTargetIsWireless) {
          video.pause();
          video.removeAttribute("src");
          video.preload = "none";
          video.load();
          video.classList.remove("is-active");
          setPickerOpen(false);
          setMessage("");
        }
        pickerTimerRef.current = null;
      }, 30000);
    } catch (error) {
      video.pause();
      video.classList.remove("is-active");
      setPickerOpen(false);
      setMessage(error.message || "Safari 无法打开 AirPlay 设备选择器");
    }
  }, [prepare]);

  return {
    videoRef,
    primeForPicker,
    /* 页面用它注册"投屏接管音频会话之后，把音乐续上"的动作。 */
    onAudioSessionReleased: (fn) => {
      onAudioSessionReleasedRef.current = fn;
    },
    streamUrl: session?.streamUrl || "",
    supported,
    availability,
    wireless,
    engaged,
    pickerOpen,
    message,
    transportLatencyMs,
    lyricsOffsetMs,
    adjustLyricsOffset,
    resetLyricsOffset: () => setLyricsOffsetMs(0),
    showPicker,
  };
}

export function AirPlayCastButton({ cast, overlay = false }) {
  /*
   * 不支持的浏览器要在**点之前**就看出来。
   *
   * AirPlay 的 `webkitShowPlaybackTargetPicker` 只有 Safari 有。原来这里
   * 一律显示"投到电视"，Chrome/Edge/Firefox/安卓上点下去只会
   * setMessage(...)，而那条消息只在「歌词」标签页里渲染 —— 用户在页头
   * 点的按钮，提示出现在他看不见的地方，于是"投屏毫无反应"。
   * 这不是能力问题，是 Apple 只给 Safari 开了这个接口，
   * 所以要把限制讲清楚，而不是摆一个点不动的按钮。
   */
  const label = cast.wireless
    ? "正在投到电视"
    : cast.pickerOpen
      ? "正在选择电视"
      : cast.supported
        ? "投到电视"
        : "投屏需用 Safari";
  return (
    <button
      type="button"
      className={`airplay-cast-button ${overlay ? "overlay" : ""} ${cast.wireless ? "active" : ""} ${cast.pickerOpen ? "pending" : ""}`}
      /* pointerdown 比 click 早一步，先把 HLS 拉起来 —— 见 primeForPicker。 */
      onPointerDown={cast.primeForPicker}
      onClick={cast.showPicker}
      aria-label={label}
      aria-pressed={cast.wireless}
      title={
        cast.supported
          ? cast.availability === "not-available"
            ? "Safari 当前未发现可用的 AirPlay 目标"
            : "打开 Apple 系统原生 AirPlay 设备选择器"
          : "AirPlay 的设备选择器只有 Safari 提供。在 iPhone、iPad 或 Mac 的 Safari 里打开这个页面就能投屏。"
      }
    >
      <Airplay />
      <span>{label}</span>
      {cast.wireless && <i aria-hidden="true" />}
    </button>
  );
}
