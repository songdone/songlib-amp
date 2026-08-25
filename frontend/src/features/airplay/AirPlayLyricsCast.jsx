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
  const pickerTimerRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [session, setSession] = useState(null);
  const [engaged, setEngaged] = useState(false);
  const [wireless, setWireless] = useState(false);
  const [availability, setAvailability] = useState("unknown");
  const [message, setMessage] = useState("");
  const hasTrack = Boolean(track);

  latestPayloadRef.current = airPlayStatePayload({ track, lyrics, player });

  useEffect(() => {
    const video = videoRef.current;
    const available = nativeAirPlayAvailable(video);
    setSupported(available);
    if (!video || !available) return undefined;
    const onAvailability = (event) =>
      setAvailability(event.availability || "unknown");
    const onWirelessChange = () => {
      const active = Boolean(video.webkitCurrentPlaybackTargetIsWireless);
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
    };
    video.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      onAvailability,
    );
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
    const currentSession = sessionRef.current;
    if (!currentSession?.sessionId || !latestPayloadRef.current?.trackId)
      return;
    try {
      const updated = await api(
        `/api/airplay/cast/${currentSession.sessionId}`,
        {
          method: "PATCH",
          body: JSON.stringify(latestPayloadRef.current),
        },
      );
      sessionRef.current = { ...currentSession, ...updated };
      setSession((value) => ({ ...value, ...updated }));
      if (updated.status === "error")
        setMessage(updated.error || "歌词视频流异常");
    } catch (error) {
      setMessage(error.message || "歌词投屏时钟同步失败");
    }
  }, []);

  const metadataKey = `${airPlayTrackId(track)}|${String(lyrics || "").length}|${player.quality}|${player.isPlaying}|${player.duration}`;
  useEffect(() => {
    if (!session?.sessionId) return;
    sync();
  }, [session?.sessionId, metadataKey, sync]);

  useEffect(() => {
    if (!session?.sessionId || !engaged) return undefined;
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [session?.sessionId, engaged, sync]);

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
