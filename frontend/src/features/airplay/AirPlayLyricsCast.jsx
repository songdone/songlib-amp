import { useCallback, useEffect, useRef, useState } from "react";
import { Airplay } from "lucide-react";

import { api } from "../../lib/api";
import {
  airPlayLiveLatencyMs,
  airPlayStatePayload,
  airPlayTrackId,
  nativeAirPlayAvailable,
} from "../../lib/airplay";

export function useAirPlayLyricsCast({ track, lyrics, player }) {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const creatingRef = useRef(null);
  const syncingRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const pickerTimerRef = useRef(null);
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
      setMessage(
        active
          ? "Apple TV 歌词视频已连接；切歌无需重连"
          : "",
      );
      if (active) {
        video.play().catch(() => {
          setMessage("Apple TV 已选择，但视频传输未能启动，请重新打开设备选择器");
        });
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
          ? `歌词视频流加载失败（媒体错误 ${code}），请重新投屏`
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

  const sync = useCallback(async () => {
    if (syncingRef.current) {
      syncQueuedRef.current = true;
      return;
    }
    syncingRef.current = true;
    try {
      do {
        syncQueuedRef.current = false;
        const currentSession = sessionRef.current;
        const payload = latestPayloadRef.current;
        if (!currentSession?.sessionId || !payload?.trackId) return;
        const updated = await api(
          `/api/airplay/cast/${currentSession.sessionId}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
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
    String(lyrics || "").length,
    player.quality,
    player.isPlaying,
    player.duration,
    lyricsOffsetMs,
    transportLatencyMs,
  ].join("|");
  useEffect(() => {
    if (!session?.sessionId) return;
    sync();
  }, [session?.sessionId, metadataKey, sync]);

  useEffect(() => {
    if (!session?.sessionId || !engaged) return undefined;
    const timer = window.setInterval(sync, 1000);
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

  const showPicker = useCallback(async () => {
    const video = videoRef.current;
    if (!nativeAirPlayAvailable(video)) {
      setMessage(
        "此设备保留投屏控制，但不能原生发起 AirPlay；请使用 iPhone、iPad 或 macOS Safari。",
      );
      return;
    }
    const ready = sessionRef.current;
    if (!ready) {
      setMessage("正在准备固定投屏地址，准备好后请再点一次“投到电视”。");
      try {
        await prepare();
      } catch {}
      return;
    }
    setPickerOpen(true);
    setMessage("请选择同一网络中的 Apple TV");
    try {
      if (video.currentSrc !== ready.streamUrl && video.src !== ready.streamUrl) {
        video.src = ready.streamUrl;
      }
      video.muted = true;
      // Ask Safari to identify the HLS resource and its video/audio tracks while
      // the native picker is open. Playback still starts only after the route is
      // wireless, so the iPad does not decode the 1080p stream in parallel.
      video.preload = "metadata";
      video.load();
      video.webkitShowPlaybackTargetPicker();
      if (pickerTimerRef.current) window.clearTimeout(pickerTimerRef.current);
      pickerTimerRef.current = window.setTimeout(() => {
        if (!video.webkitCurrentPlaybackTargetIsWireless) {
          video.pause();
          video.removeAttribute("src");
          video.preload = "none";
          video.load();
          setPickerOpen(false);
          setMessage("");
        }
        pickerTimerRef.current = null;
      }, 30000);
    } catch (error) {
      setPickerOpen(false);
      setMessage(error.message || "Safari 无法打开 AirPlay 设备选择器");
    }
  }, [prepare]);

  return {
    videoRef,
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
  const label = cast.wireless
    ? "正在投到电视"
    : cast.pickerOpen
      ? "正在选择电视"
      : "投到电视";
  return (
    <button
      type="button"
      className={`airplay-cast-button ${overlay ? "overlay" : ""} ${cast.wireless ? "active" : ""} ${cast.pickerOpen ? "pending" : ""}`}
      onClick={cast.showPicker}
      aria-label={label}
      aria-pressed={cast.wireless}
      title={
        cast.supported
          ? cast.availability === "not-available"
            ? "Safari 当前未发现可用的 AirPlay 目标"
            : "打开 Apple 系统原生 AirPlay 设备选择器"
          : "此设备不能原生发起 AirPlay"
      }
    >
      <Airplay />
      <span>{label}</span>
      {cast.wireless && <i aria-hidden="true" />}
    </button>
  );
}
