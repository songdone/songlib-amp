import { useCallback, useEffect, useRef, useState } from "react";
import { Airplay } from "lucide-react";

import { api } from "../../lib/api";
import {
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
  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState(null);
  const [engaged, setEngaged] = useState(false);
  const [wireless, setWireless] = useState(false);
  const [availability, setAvailability] = useState("unknown");
  const [message, setMessage] = useState("");
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(() => {
    const saved = Number(window.localStorage.getItem("songlib-airplay-lyrics-offset") || 0);
    return Number.isFinite(saved) ? Math.max(-5000, Math.min(5000, saved)) : 0;
  });
  const hasTrack = Boolean(track);
  const playerRef = useRef(player);
  const wirelessRef = useRef(false);

  playerRef.current = player;
  latestPayloadRef.current = airPlayStatePayload({ track, lyrics, player, lyricsOffsetMs });

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
      if (active && pickerTimerRef.current) {
        window.clearTimeout(pickerTimerRef.current);
        pickerTimerRef.current = null;
      }
      setWireless(active);
      setEngaged(active);
      setMessage(
        active
          ? "歌词视频正在投到电视；音频仍由所选播放设备输出，切歌无需重连"
          : "",
      );
      if (!active) video.pause();
      if (active && !playerRef.current?.isPlaying) video.pause();
    };
    const onPlay = () => {
      if (!wirelessRef.current || playerRef.current?.isPlaying) return;
      if (typeof playerRef.current?.play === "function") playerRef.current.play();
      else playerRef.current?.toggle?.();
    };
    const onPause = () => {
      if (!wirelessRef.current || !playerRef.current?.isPlaying) return;
      if (typeof playerRef.current?.pause === "function") playerRef.current.pause();
      else playerRef.current?.toggle?.();
    };
    video.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      onAvailability,
    );
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWirelessChange,
    );
    return () => {
      if (pickerTimerRef.current) window.clearTimeout(pickerTimerRef.current);
      video.removeEventListener(
        "webkitplaybacktargetavailabilitychanged",
        onAvailability,
      );
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener(
        "webkitcurrentplaybacktargetiswirelesschanged",
        onWirelessChange,
      );
    };
  }, [hasTrack]);

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

  const metadataKey = `${airPlayTrackId(track)}|${String(lyrics || "").length}|${player.quality}|${player.isPlaying}|${player.duration}|${lyricsOffsetMs}`;
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
    window.localStorage.setItem("songlib-airplay-lyrics-offset", String(lyricsOffsetMs));
  }, [lyricsOffsetMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!wireless || !video) return;
    if (player.isPlaying && video.paused) video.play().catch(() => {});
    if (!player.isPlaying && !video.paused) video.pause();
  }, [wireless, player.isPlaying]);

  useEffect(() => {
    const mediaSession = navigator.mediaSession;
    if (!engaged || !mediaSession) return undefined;
    const play = () => {
      if (typeof playerRef.current?.play === "function") playerRef.current.play();
      else if (!playerRef.current?.isPlaying) playerRef.current?.toggle?.();
    };
    const pause = () => {
      if (typeof playerRef.current?.pause === "function") playerRef.current.pause();
      else if (playerRef.current?.isPlaying) playerRef.current?.toggle?.();
    };
    const actions = {
      play,
      pause,
      previoustrack: () => playerRef.current?.previous?.(),
      nexttrack: () => playerRef.current?.next?.(),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try { mediaSession.setActionHandler(action, handler); } catch {}
    }
    return () => {
      for (const action of Object.keys(actions)) {
        try { mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, [engaged]);

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
    setEngaged(true);
    setMessage("请选择同一网络中的 Apple TV");
    try {
      if (video.src !== ready.streamUrl) {
        video.src = ready.streamUrl;
        video.load();
      }
      video.muted = true;
      video.play().catch(() => {});
      video.webkitShowPlaybackTargetPicker();
      if (pickerTimerRef.current) window.clearTimeout(pickerTimerRef.current);
      pickerTimerRef.current = window.setTimeout(() => {
        if (!video.webkitCurrentPlaybackTargetIsWireless) {
          video.pause();
          setEngaged(false);
          setMessage("");
        }
        pickerTimerRef.current = null;
      }, 30000);
    } catch (error) {
      setEngaged(false);
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
    message,
    lyricsOffsetMs,
    adjustLyricsOffset,
    resetLyricsOffset: () => setLyricsOffsetMs(0),
    showPicker,
  };
}

export function AirPlayCastButton({ cast, overlay = false }) {
  const label = cast.wireless ? "正在投到电视" : "投到电视";
  return (
    <button
      type="button"
      className={`airplay-cast-button ${overlay ? "overlay" : ""} ${cast.wireless ? "active" : ""}`}
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
