import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ResumePrompt } from "./ResumePrompt";
import { fetchResumePoint, useResumeReporter } from "./useResumePoint";
import { api } from "../../lib/api";
import { playbackDurationSeconds, playlistTrackPayload } from "../../lib/contracts";
import { isPlayableDuration, normalizeTrackTitle, persistableTrack, sanitizeQueue, trackIdentity } from "../../lib/media";
import { storedJson } from "../../lib/storage";

export const PLAYBACK_QUALITIES = ["original", "320k", "256k", "192k", "128k"];

const QUALITY_STORAGE_KEY = "songlib-player-quality";

/*
 * 远程播放音质只有一处真相。
 *
 * 以前有两处：「播放器设置 → 远程默认 320K」（存服务端 settings.player.remoteBitrate）
 * 和「用户偏好 → 默认音质」（存 profile.defaultQuality，选项里还有 FLAC / Hi-Res ——
 * 那是下载音质，Plex 转码根本没有这两档）。用户取消了前者，后者还在发 320k。
 * 现在：本机选过就听本机的，没选过才用服务端的默认值；profile.defaultQuality
 * 只管下载，不再参与播放。
 */
const normalizeQuality = (value) =>
  PLAYBACK_QUALITIES.includes(value) ? value : "";

const storedQuality = () => normalizeQuality(storedJson(QUALITY_STORAGE_KEY, ""));

const PlayerContext = createContext(null);

const PlayerClockContext = createContext({ currentTime: 0, duration: 0 });

export const usePlayerCore = () => useContext(PlayerContext);

export const usePlayer = () => {
  const player = usePlayerCore();
  const clock = useContext(PlayerClockContext);
  return useMemo(() => ({ ...player, ...clock }), [player, clock]);
};

export const sourceLabel = (sourceType) =>
  ({
    local_file: "本地文件",
    plex_item: "Plex 曲目",
    source_preview: "下载前试听",
  })[sourceType] || "本地文件";

function immediatePlaybackTrack(input, quality = "original") {
  if (!input) return null;
  let candidate = input;
  if (Array.isArray(input.resources)) {
    const resource =
      input.preferredResource ||
      input.resources.find((item) => item.type === "local_file") ||
      input.resources.find((item) => item.type === "plex_item");
    if (!resource) return null;
    candidate = {
      ...input,
      ...resource,
      source: resource.source || resource.type,
      sourceType: resource.type,
    };
  }
  const sourceType =
    candidate.sourceType ||
    candidate.source ||
    (candidate.ratingKey || candidate.plexRatingKey
      ? "plex_item"
      : "local_file");
  const duration = playbackDurationSeconds(candidate.duration);
  if (sourceType === "local_file") {
    const id = candidate.localFileId || candidate.id;
    if (!id || (!candidate.path && !candidate.file)) return null;
    return {
      id: `local-${id}`,
      sourceType: "local_file",
      title: normalizeTrackTitle(candidate.title || candidate.filename),
      artist: candidate.artist || "未知歌手",
      album: candidate.album || "未知专辑",
      duration,
      coverUrl:
        candidate.coverUrl ||
        (candidate.hasCover || candidate.has_cover
          ? `/api/local/files/${encodeURIComponent(id)}/cover`
          : ""),
      artistBackgroundUrl: candidate.artistBackgroundUrl || "",
      audioUrl: `/api/local/files/${encodeURIComponent(id)}/stream`,
      lyrics: candidate.lyrics || "",
      quality: "original",
      bitrate: "original",
      localFileId: id,
      file: candidate.path || candidate.file || "",
      raw: candidate,
    };
  }
  if (sourceType === "plex_item") {
    const ratingKey =
      candidate.plexRatingKey || candidate.ratingKey || candidate.id;
    if (!ratingKey) return null;
    return {
      id: `plex-${ratingKey}`,
      sourceType: "plex_item",
      title: normalizeTrackTitle(candidate.title),
      artist: candidate.artist || candidate.grandparentTitle || "未知歌手",
      album: candidate.album || candidate.parentTitle || "未知专辑",
      duration,
      coverUrl: candidate.coverUrl || candidate.thumbUrl || "",
      artistBackgroundUrl:
        candidate.artistBackgroundUrl || candidate.artUrl || "",
      audioUrl: `/api/player/plex/${encodeURIComponent(ratingKey)}/stream?bitrate=${encodeURIComponent(quality)}`,
      lyrics: candidate.lyrics || "",
      quality,
      bitrate: quality,
      plexRatingKey: ratingKey,
      file: candidate.path || candidate.file || "",
      raw: candidate,
    };
  }
  return null;
}

async function toPlaybackTrack(input, quality = "original") {
  if (!input) return null;
  if (Array.isArray(input.resources)) {
    const resource =
      input.preferredResource ||
      input.resources.find((item) => item.type === "local_file") ||
      input.resources.find((item) => item.type === "plex_item");
    if (!resource) throw new Error("这首歌没有可播放资源");
    return toPlaybackTrack(
      {
        ...input,
        ...resource,
        source: resource.source || resource.type,
        sourceType: resource.type,
      },
      quality,
    );
  }
  if (
    input.sourceType &&
    input.audioUrl &&
    input.sourceType !== "plex_item"
  )
    return input;
  const sourceType = input.sourceType || input.source || "local_file";
  if (sourceType === "plex_item") {
    const ratingKey = input.plexRatingKey || input.ratingKey;
    const info = await api(`/api/plex/items/${ratingKey}/playback`);
    const audioUrl =
      quality === "original"
        ? info.directPlayUrl
        : info.transcodeUrls?.[quality] || info.directPlayUrl;
    return {
      id: `plex-${ratingKey}`,
      sourceType: "plex_item",
      title: normalizeTrackTitle(info.title),
      artist: info.artist,
      album: info.album,
      duration: Math.round((info.duration || 0) / 1000),
      coverUrl: info.coverUrl,
      artistBackgroundUrl: info.artistBackgroundUrl,
      audioUrl,
      lyrics: info.lyrics || "",
      quality,
      bitrate: quality,
      plexRatingKey: ratingKey,
      file: info.file,
      openPlexUrl: info.openPlexUrl,
      transcodeUrls: info.transcodeUrls || {},
      raw: info,
    };
  }
  if (sourceType === "source_preview") {
    const data = await api("/api/player/source-preview", {
      method: "POST",
      body: JSON.stringify({
        sourceId: input.sourceId,
        quality: input.quality || quality,
        item: input.item || input,
      }),
    });
    return {
      id: `preview-${input.trackId || input.id || Date.now()}`,
      sourceType: "source_preview",
      title: normalizeTrackTitle(data.title || input.title),
      artist: data.artist || input.artist,
      album: data.album || input.album,
      coverUrl: data.coverUrl || input.coverUrl || input.cover,
      audioUrl: data.streamUrl,
      lyrics: "",
      quality: data.quality || input.quality || quality,
      sourceId: input.sourceId,
      raw: input,
    };
  }
  const data = await api(`/api/player/local/${input.localFileId || input.id}`);
  let lyrics = "";
  if (data.lyricsUrl) {
    const lyricData = await api(data.lyricsUrl).catch(() => ({ lyrics: "" }));
    lyrics = lyricData.lyrics || "";
  }
  return {
    id: `local-${data.id}`,
    sourceType: "local_file",
    title: normalizeTrackTitle(data.title || data.filename),
    artist: data.artist,
    album: data.album,
    duration: Math.round((data.duration || 0) / 1000),
    coverUrl: data.coverUrl,
    artistBackgroundUrl: data.artistBackgroundUrl,
    audioUrl: data.streamUrl,
    lyrics,
    quality: "original",
    bitrate: "original",
    localFileId: data.id,
    file: data.file,
    raw: data,
  };
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const hydratedRef = useRef(false);
  const progressMilestoneRef = useRef(0);
  /*
   * 待执行的起播位置。
   *
   * 必须等 loadedmetadata 才能 seek：在那之前 audio.duration 是 NaN，
   * 给 currentTime 赋值会被浏览器静默忽略，而且随后的 load()
   * 也会把它冲回 0。所以先记下来，等元数据到了再跳。
   */
  const pendingSeekRef = useRef(0);
  const playlistIdsRef = useRef({});
  const playlistCreateRef = useRef({});
  const previousTracksRef = useRef([]);
  const navigatingBackRef = useRef(false);
  const [state, setState] = useState({
    currentTrack: null,
    queue: [],
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.86,
    playMode: "order",
    quality: storedQuality() || "original",
    loading: false,
    error: "",
  });
  const [favorites, setFavorites] = useState(() =>
    storedJson("songlib-favorites", {}),
  );
  const [history, setHistory] = useState(() =>
    storedJson("songlib-play-history", []),
  );
  const [playEvents, setPlayEvents] = useState(() =>
    storedJson("songlib-play-events", []),
  );
  const [playlists, setPlaylists] = useState(() =>
    storedJson("songlib-playlists", {}),
  );
  const currentTrack = state.currentTrack;

  /* ----------------------------------------------------------------
   * 跨设备续播
   *
   * readPosition 从 audio 元素上直接读，不从 state 读 —— state.currentTime
   * 每秒变四次，用它当依赖会让上报的定时器每秒重建四次。
   * ---------------------------------------------------------------- */
  const [resumeOffer, setResumeOffer] = useState(null);
  useResumeReporter({
    track: currentTrack,
    isPlaying: state.isPlaying,
    readPosition: () => {
      const audio = audioRef.current;
      return {
        position: audio?.currentTime || 0,
        duration: Number.isFinite(audio?.duration) ? audio.duration : 0,
      };
    },
  });

  // 换歌时问一次"要不要接着上次的位置"。
  // 只问，不跳 —— 自动跳是那种第一次遇到会以为是 bug 的"聪明"。
  useEffect(() => {
    setResumeOffer(null);
    if (!currentTrack) return undefined;
    let alive = true;
    fetchResumePoint(currentTrack).then((point) => {
      if (alive && point) setResumeOffer(point);
    });
    return () => {
      alive = false;
    };
  }, [currentTrack && trackIdentity(currentTrack)]);
  const sendListeningEvent = (eventType, track, position = 0, duration = 0) => {
    if (!track) return;
    api("/api/listening/events", {
      method: "POST",
      body: JSON.stringify({
        eventType,
        fileId: track.localFileId || (track.sourceType === "local_file" ? track.raw?.id : null),
        externalRef:
          track.localFileId || track.sourceType === "local_file"
            ? null
            : trackIdentity(track),
        positionMs: Math.round(Number(position || 0) * 1000),
        durationMs: Math.round(Number(duration || track.duration || 0) * 1000),
        context: { sourceType: track.sourceType || "unknown" },
      }),
    }).catch(() => {});
  };
  useEffect(() => {
    let cancelled = false;
    api("/api/player/state")
      .then(async (remote) => {
        if (cancelled) return;
        if (Object.keys(remote.favorites || {}).length)
          setFavorites(remote.favorites);
        if ((remote.history || []).length) setHistory(remote.history);
        if ((remote.playEvents || []).length) setPlayEvents(remote.playEvents);
        if (Object.keys(remote.playlists || {}).length)
          setPlaylists(remote.playlists);
        if ((remote.queue || []).length)
          setState((value) => ({
            ...value,
            queue: sanitizeQueue(remote.queue),
          }));
        if (remote.currentTrack) {
          try {
            /* 恢复上次那首时也要用当前音质，不能写死 "original" ——
               否则用户选的 320K 每次刷新都被悄悄降回原始音质，
               看起来就是"设置不生效"。音质的唯一真相见文件顶部。 */
            const restored = await toPlaybackTrack(
              remote.currentTrack,
              storedQuality() || "original",
            );
            if (!cancelled)
              setState((value) => ({
                ...value,
                currentTrack: restored,
                isPlaying: false,
                duration: restored.duration || 0,
              }));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => {
        hydratedRef.current = true;
      });
    api("/api/playlists")
      .then(async (data) => {
        const details = await Promise.all(
          (data.items || []).map((item) => api(`/api/playlists/${item.id}`)),
        );
        const mapped = {};
        for (const playlist of details) {
          playlistIdsRef.current[playlist.name] = playlist.id;
          mapped[playlist.name] = (playlist.items || []).map((item) => ({
            id: item.file_id ? `local-${item.file_id}` : item.id,
            sourceType: item.file_id ? "local_file" : "external",
            localFileId: item.file_id,
            title: item.title,
            artist: item.artist,
            album: item.album,
            duration: item.duration,
            file: item.path,
            externalRef: item.external_ref,
          }));
        }
        if (!cancelled) setPlaylists(mapped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("songlib-favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem(
      "songlib-play-history",
      JSON.stringify(history.slice(0, 100)),
    );
  }, [history]);
  useEffect(() => {
    localStorage.setItem(
      "songlib-play-events",
      JSON.stringify(playEvents.slice(0, 1000)),
    );
  }, [playEvents]);
  useEffect(() => {
    localStorage.setItem("songlib-playlists", JSON.stringify(playlists));
  }, [playlists]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(
      () =>
        api("/api/player/state", {
          method: "PATCH",
          body: JSON.stringify({
            values: {
              queue: state.queue.map(persistableTrack).filter(Boolean),
              currentTrack: persistableTrack(state.currentTrack),
              favorites,
              history,
              playEvents,
              playlists,
            },
          }),
        }).catch(() => {}),
      900,
    );
    return () => clearTimeout(timer);
  }, [
    state.queue,
    state.currentTrack?.id,
    favorites,
    history,
    playEvents,
    playlists,
  ]);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = state.volume;
  }, [state.volume]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.src = currentTrack.audioUrl || "";
    audio.load();
    if (state.isPlaying && currentTrack.audioUrl)
      audio
        .play()
        .catch((err) =>
          setState((s) => ({ ...s, error: err.message, isPlaying: false })),
        );
  }, [currentTrack?.id, currentTrack?.audioUrl]);
  const remember = (track) => {
    const playedAt = new Date().toISOString();
    setPlayEvents((value) => [{ ...track, playedAt }, ...value].slice(0, 1000));
    setHistory((value) => {
      const item = { ...track, playedAt };
      return [
        item,
        ...value.filter(
          (entry) => trackIdentity(entry) !== trackIdentity(track),
        ),
      ].slice(0, 100);
    });
    progressMilestoneRef.current = 0;
    sendListeningEvent("start", track, 0, track.duration);
  };
  const play = async (input, queue) => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    // startAt 由"听到一半的"这类明确表达了续播意图的入口传进来。
    pendingSeekRef.current = Number(input?.startAt) || 0;
    try {
      const immediate = immediatePlaybackTrack(input, state.quality);
      if (immediate) {
        if (!isPlayableDuration(immediate))
          throw new Error("时长异常已跳过，文件可能损坏或没下完");
        const nextQueue = sanitizeQueue(
          Array.isArray(queue) ? queue : state.queue,
          immediate,
        );
        if (
          currentTrack &&
          trackIdentity(currentTrack) !== trackIdentity(immediate) &&
          !navigatingBackRef.current
        ) {
          previousTracksRef.current = [
            currentTrack,
            ...previousTracksRef.current.filter(
              (item) => trackIdentity(item) !== trackIdentity(currentTrack),
            ),
          ].slice(0, 50);
        }
        navigatingBackRef.current = false;
        remember(immediate);
        setState((s) => ({
          ...s,
          currentTrack: immediate,
          queue: nextQueue,
          isPlaying: true,
          loading: false,
          currentTime: 0,
          duration: immediate.duration || 0,
          error: "",
        }));
        const audio = audioRef.current;
        if (audio) {
          audio.src = immediate.audioUrl;
          audio.load();
          audio.play().catch((err) =>
            setState((s) => ({
              ...s,
              isPlaying: false,
              error: err.message || "浏览器拦了自动播放，再点一次",
            })),
          );
        }
        toPlaybackTrack(input, state.quality)
          .then((fullTrack) => {
            if (!fullTrack) return;
            setState((s) =>
              trackIdentity(s.currentTrack) === trackIdentity(immediate)
                ? {
                    ...s,
                    currentTrack: {
                      ...immediate,
                      ...fullTrack,
                      audioUrl: immediate.audioUrl,
                    },
                  }
                : s,
            );
          })
          .catch(() => {});
        return;
      }
      const track = await toPlaybackTrack(input, state.quality);
      if (!track?.audioUrl)
        throw new Error(
          "没取到播放地址；HTTPS 下需确认播放流走内置代理",
        );
      if (!isPlayableDuration(track))
        throw new Error("时长异常，已阻止播放");
      const nextQueue = sanitizeQueue(
        Array.isArray(queue) ? queue : state.queue,
        track,
      );
      if (
        currentTrack &&
        trackIdentity(currentTrack) !== trackIdentity(track) &&
        !navigatingBackRef.current
      ) {
        previousTracksRef.current = [
          currentTrack,
          ...previousTracksRef.current.filter(
            (item) => trackIdentity(item) !== trackIdentity(currentTrack),
          ),
        ].slice(0, 50);
      }
      navigatingBackRef.current = false;
      remember(track);
      setState((s) => ({
        ...s,
        currentTrack: track,
        queue: nextQueue,
        isPlaying: true,
        loading: false,
        currentTime: 0,
        duration: track.duration || 0,
        error: "",
      }));
    } catch (err) {
      navigatingBackRef.current = false;
      setState((s) => ({
        ...s,
        loading: false,
        isPlaying: false,
        error: err.message || "播放失败",
      }));
    }
  };
  const pause = () => {
    audioRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
  };
  const resume = () => {
    if (!state.currentTrack?.audioUrl) {
      setState((s) => ({ ...s, error: "当前曲目没有可播放地址" }));
      return;
    }
    audioRef.current
      ?.play()
      .then(() => setState((s) => ({ ...s, isPlaying: true, error: "" })))
      .catch((err) =>
        setState((s) => ({ ...s, error: err.message, isPlaying: false })),
      );
  };
  const toggle = () =>
    state.currentTrack
      ? state.isPlaying
        ? pause()
        : resume()
      : setState((s) => ({
          ...s,
          error: "队列是空的，随机来一首或去音乐库挑",
        }));
  const seek = (time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setState((s) => ({ ...s, currentTime: time }));
  };
  const setVolume = (volume) =>
    setState((s) => ({ ...s, volume: Number(volume) }));
  const setQuality = async (quality) => {
    const audio = audioRef.current;
    const keep = audio?.currentTime || 0;
    const next = normalizeQuality(quality) || "original";
    try {
      localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 隐身模式下写不进去，不影响本次播放 */
    }
    quality = next;
    setState((s) => ({ ...s, quality: next }));
    if (!currentTrack) return;
    if (currentTrack.sourceType === "plex_item") {
      const track = await toPlaybackTrack(
        {
          ...currentTrack,
          source: "plex_item",
          ratingKey: currentTrack.plexRatingKey,
        },
        quality,
      );
      setState((s) => ({ ...s, currentTrack: track, isPlaying: s.isPlaying }));
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = keep;
          if (state.isPlaying) audioRef.current.play().catch(() => {});
        }
      }, 200);
    }
  };
  const setQueue = (queue) =>
    setState((s) => ({ ...s, queue: sanitizeQueue(queue, s.currentTrack) }));
  const addToQueue = async (input) => {
    try {
      const track = await toPlaybackTrack(input, state.quality);
      if (!isPlayableDuration(track)) throw new Error("时长异常，已跳过");
      setState((s) => ({
        ...s,
        queue: sanitizeQueue([...s.queue, track], s.currentTrack),
        error: "",
      }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message || "加入队列失败" }));
    }
  };
  const removeFromQueue = (id) =>
    setState((s) => ({
      ...s,
      queue: s.queue.filter((item) => item.id !== id),
    }));
  const setPlayMode = (playMode) => setState((s) => ({ ...s, playMode }));
  const favoriteId = (track) =>
    track?.id || track?.ratingKey || track?.localFileId || track?.title;
  const isFavorite = (track) => !!favorites[favoriteId(track)];
  const toggleFavorite = (track) => {
    const id = favoriteId(track);
    if (!id) return;
    const removing = isFavorite(track);
    setFavorites((value) => {
      const next = { ...value };
      next[id]
        ? delete next[id]
        : (next[id] = {
            ...track,
            title: track.title,
            artist: track.artist,
            album: track.album,
            likedAt: new Date().toISOString(),
          });
      return next;
    });
    sendListeningEvent(removing ? "unfavorite" : "favorite", track, state.currentTime, state.duration);
  };
  const ensureServerPlaylist = async (name) => {
    if (playlistIdsRef.current[name]) return playlistIdsRef.current[name];
    if (!playlistCreateRef.current[name]) {
      playlistCreateRef.current[name] = api("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ name, description: "", items: [] }),
      })
        .catch(async (err) => {
          if (!err.message.includes("同名")) throw err;
          const data = await api("/api/playlists");
          const existing = (data.items || []).find((item) => item.name === name);
          if (!existing) throw err;
          return existing;
        })
        .then((item) => {
          playlistIdsRef.current[name] = item.id;
          return item.id;
        })
        .finally(() => {
          delete playlistCreateRef.current[name];
        });
    }
    return playlistCreateRef.current[name];
  };
  const createPlaylist = (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    setPlaylists((value) => (value[clean] ? value : { ...value, [clean]: [] }));
    ensureServerPlaylist(clean).catch((err) =>
      setState((value) => ({ ...value, error: err.message })),
    );
  };
  const deletePlaylist = (name) => {
    const playlistId = playlistIdsRef.current[name];
    setPlaylists((value) => {
      const next = { ...value };
      delete next[name];
      return next;
    });
    if (playlistId) {
      api(`/api/playlists/${playlistId}`, { method: "DELETE" })
        .then(() => {
          delete playlistIdsRef.current[name];
        })
        .catch((err) => setState((value) => ({ ...value, error: err.message })));
    }
  };
  const addToPlaylist = (name, track) => {
    if (!name || !track) return;
    setPlaylists((value) => {
      const items = value[name] || [];
      if (items.some((item) => trackIdentity(item) === trackIdentity(track)))
        return value;
      const nextItems = [...items, persistableTrack(track)].filter(Boolean);
      const updateServer = async () => {
        const playlistId = await ensureServerPlaylist(name);
        await api(`/api/playlists/${playlistId}`, {
          method: "PATCH",
          body: JSON.stringify({
            items: nextItems.map(playlistTrackPayload),
          }),
        });
      };
      updateServer().catch((err) =>
        setState((current) => ({ ...current, error: err.message })),
      );
      return {
        ...value,
        [name]: nextItems,
      };
    });
  };
  const next = (completed = false) => {
    if (!completed && currentTrack && state.duration && state.currentTime / state.duration < 0.85)
      sendListeningEvent("skip", currentTrack, state.currentTime, state.duration);
    const nextTrack = state.queue[0];
    if (nextTrack) {
      play(nextTrack, state.queue.slice(1));
    }
  };
  const previous = () => {
    if (state.currentTime > 5 || !previousTracksRef.current.length) {
      seek(0);
      return;
    }
    const previousTrack = previousTracksRef.current.shift();
    if (!previousTrack) return;
    navigatingBackRef.current = true;
    const nextQueue = sanitizeQueue(
      [currentTrack, ...state.queue].filter(Boolean),
      previousTrack,
    );
    play(previousTrack, nextQueue);
  };
  /* 服务端「播放器设置 → 远程播放音质」。本机选过就不覆盖 —— 否则用户
     在迷你条上选的档位每次刷新都会被服务端默认值顶掉。 */
  const applyRemoteDefaultQuality = (value) => {
    if (storedQuality()) return;
    const next = normalizeQuality(value);
    if (!next) return;
    setState((s) => (s.quality === next ? s : { ...s, quality: next }));
  };
  const clear = () => {
    audioRef.current?.pause();
    previousTracksRef.current = [];
    setState((s) => ({
      ...s,
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      error: "",
    }));
  };
  const actionImplementationsRef = useRef({});
  actionImplementationsRef.current = {
    play,
    pause,
    resume,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    setQueue,
    addToQueue,
    removeFromQueue,
    setQuality,
    applyRemoteDefaultQuality,
    setPlayMode,
    isFavorite,
    toggleFavorite,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    clear,
  };
  const actions = useMemo(() => {
    const result = {};
    for (const name of Object.keys(actionImplementationsRef.current)) {
      result[name] = (...args) => actionImplementationsRef.current[name](...args);
    }
    return result;
  }, []);
  const value = useMemo(
    () => ({
      currentTrack: state.currentTrack,
      queue: state.queue,
      isPlaying: state.isPlaying,
      volume: state.volume,
      playMode: state.playMode,
      quality: state.quality,
      loading: state.loading,
      error: state.error,
      audioRef,
      history,
      playEvents,
      playlists,
      favorites,
      ...actions,
    }),
    [
      state.currentTrack,
      state.queue,
      state.isPlaying,
      state.volume,
      state.playMode,
      state.quality,
      state.loading,
      state.error,
      history,
      playEvents,
      playlists,
      favorites,
      actions,
    ],
  );
  const clock = useMemo(
    () => ({ currentTime: state.currentTime, duration: state.duration }),
    [state.currentTime, state.duration],
  );
  return (
    <PlayerContext.Provider value={value}>
      <PlayerClockContext.Provider value={clock}>
        {children}
        <ResumePrompt
          offer={resumeOffer}
          onAccept={() => {
            seek(resumeOffer.position);
            setResumeOffer(null);
          }}
          onDismiss={() => setResumeOffer(null)}
        />
        <audio
        ref={audioRef}
        className="global-audio"
        x-webkit-airplay="deny"
        disableRemotePlayback
        controlsList="noremoteplayback"
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          const currentTime = audio.currentTime || 0;
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          setState((s) => ({
            ...s,
            currentTime,
            duration: duration || s.duration,
          }));
          const ratio = duration ? currentTime / duration : 0;
          const milestone = ratio >= 0.75 ? 75 : ratio >= 0.5 ? 50 : ratio >= 0.25 ? 25 : 0;
          if (milestone > progressMilestoneRef.current) {
            progressMilestoneRef.current = milestone;
            sendListeningEvent("progress", currentTrack, currentTime, duration);
          }
        }}
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          setState((s) => ({ ...s, duration: duration || s.duration }));
          const target = pendingSeekRef.current;
          pendingSeekRef.current = 0;
          // 落在时长范围内才跳。存的位置可能来自另一个版本
          // （比如更短的单曲版），越界的 seek 会让浏览器直接结束这首。
          if (target > 0 && (!duration || target < duration - 1)) {
            audio.currentTime = target;
            setState((s) => ({ ...s, currentTime: target }));
          }
        }}
        onError={(e) => {
          const error = e.currentTarget.error;
          const messages = {
            1: "播放已中止",
            2: "连接断了，过会儿再试",
            3: "音频格式无法解码",
            4: "这个格式浏览器放不了",
          };
          setState((s) => ({
            ...s,
            isPlaying: false,
            error: messages[error?.code] || "这首暂时放不出来，过会儿再试",
          }));
        }}
        onPlay={() => setState((s) => ({ ...s, isPlaying: true, error: "" }))}
        onPause={() => setState((s) => ({ ...s, isPlaying: false }))}
        onEnded={() => {
          sendListeningEvent("complete", currentTrack, state.duration, state.duration);
          if (state.playMode === "repeat_one") {
            sendListeningEvent("replay", currentTrack, 0, state.duration);
            seek(0);
            audioRef.current?.play().catch(() => {});
          } else next(true);
        }}
        />
      </PlayerClockContext.Provider>
    </PlayerContext.Provider>
  );
}
