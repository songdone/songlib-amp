import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Airplay,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Disc3,
  Heart,
  ImagePlus,
  Library,
  ListMusic,
  LoaderCircle,
  Maximize2,
  Minus,
  Mic2,
  MonitorSpeaker,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Smartphone,
  Volume2,
  X,
} from "lucide-react";

import { Button, IconButton } from "../../components/ui/Button";
import { PosterStudio } from "../share/PosterStudio";
import { api } from "../../lib/api";
import { displayLyricsFor, parseLrc } from "../../lib/lyrics";
import {
  preferredRemoteSession,
  remoteControlMessage,
  remotePositionSeconds,
  remoteTrack,
} from "../../lib/remotePlayback";
import {
  AirPlayCastButton,
  useAirPlayLyricsCast,
} from "../airplay/AirPlayLyricsCast";
import { usePlexSessions } from "./usePlexSessions";


const formatTime = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value || 0)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const coverFor = (track) =>
  track?.albumCoverUrl ||
  track?.coverUrl ||
  track?.thumbUrl ||
  track?.raw?.coverUrl ||
  track?.raw?.thumbUrl ||
  "";

function deviceIcon(session) {
  const text = `${session?.platform || ""} ${session?.device || ""} ${session?.product || ""}`.toLowerCase();
  if (/iphone|ipad|ios|android|phone/.test(text)) return Smartphone;
  if (/plexamp/.test(text)) return Radio;
  return MonitorSpeaker;
}

function DeviceRow({ session, active, onSelect }) {
  const Icon = deviceIcon(session);
  const idle = !session.title;
  const stateLabel = idle ? "空闲" : session.controllable ? "可控制" : "仅跟随";
  return (
    <button
      type="button"
      className={`now-device-row ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      <span className="now-device-icon"><Icon /></span>
      <span className="now-device-copy">
        <strong>{session.deviceName || session.name || "Plex 播放器"}</strong>
        <small>
          {session.title
            ? `${session.product || "Plex"} · ${session.playing ? "正在播放" : "已暂停"}《${session.title}》`
            : `${session.product || "Plex"} · 当前没有播放内容`}
        </small>
      </span>
      <span className={`now-device-state ${idle ? "idle" : session.controllable ? "" : "follow"}`}>
        {stateLabel}
      </span>
      {active && <Check className="now-device-check" />}
    </button>
  );
}

function ProgressSlider({ player, label, disabled = false }) {
  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  const maximum = Math.max(0, Number(player.duration || 0));
  const current = Math.min(Math.max(0, Number(player.currentTime || 0)), maximum);

  const updateDraft = (event) => {
    const value = Number(event.currentTarget.value);
    draftRef.current = value;
    setDraft(value);
  };

  const commitDraft = () => {
    if (draftRef.current === null) return;
    const value = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    player.seek(value);
  };

  return (
    <input
      type="range"
      min="0"
      max={maximum}
      value={draft ?? current}
      disabled={disabled || !player.canSeek}
      onChange={updateDraft}
      onPointerUp={commitDraft}
      onPointerCancel={() => {
        draftRef.current = null;
        setDraft(null);
      }}
      onKeyUp={commitDraft}
      onBlur={commitDraft}
      aria-label={label}
    />
  );
}

function LyricsOverlay({
  track,
  lines,
  activeLine,
  player,
  cast,
  onClose,
}) {
  const cover = coverFor(track);
  useEffect(() => {
    const close = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <section className="now-lyrics-overlay" role="dialog" aria-modal="true" aria-label="全屏歌词">
      <div className="now-lyrics-overlay-bg" aria-hidden="true">
        <img src={cover} alt="" />
      </div>
      <header>
        <button className="now-overlay-close" onClick={onClose}><X />关闭</button>
        <div className="now-overlay-track">
          <img src={cover} alt="" />
          <span><strong>{track?.title || "未命名歌曲"}</strong><small>{track?.artist || "未知歌手"} · {track?.album || "未知专辑"}</small></span>
        </div>
        <AirPlayCastButton cast={cast} overlay />
      </header>
      <div className="now-overlay-lines">
        {lines.map((line, index) => (
          <button
            key={`${line.time}-${index}`}
            className={index === activeLine ? "active" : Math.abs(index - activeLine) < 2 ? "near" : ""}
            onClick={() => player.canSeek && player.seek(line.time)}
          >
            {line.text}
          </button>
        ))}
      </div>
      <footer>
        <span>{formatTime(player.currentTime)}</span>
        <ProgressSlider player={player} label="歌词播放进度" />
        <span>{formatTime(player.duration)}</span>
        <button disabled={!player.canControl} onClick={player.previous} aria-label="上一首"><ChevronLeft /></button>
        <button className="play-large" disabled={!player.canControl} onClick={player.toggle} aria-label={player.isPlaying ? "暂停" : "播放"}>{player.isPlaying ? <Pause /> : <Play />}</button>
        <button disabled={!player.canControl} onClick={player.next} aria-label="下一首"><ChevronRight /></button>
      </footer>
    </section>
  );
}

export default function NowPlayingPage({
  player: localPlayer,
  navigate,
  playerSettings = {},
}) {
  const remote = usePlexSessions();
  const [selectedSource, setSelectedSource] = useState(
    () => localStorage.getItem("songlib-playback-source") || "auto",
  );
  const [tab, setTab] = useState("lyrics");
  const [remoteMetadata, setRemoteMetadata] = useState({});
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [controlBusy, setControlBusy] = useState("");
  const [controlMessage, setControlMessage] = useState("");
  const [remoteVolume, setRemoteVolume] = useState(100);
  const [lyricsFull, setLyricsFull] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const autoResolvedRef = useRef(false);

  const requestedSessionId = selectedSource.startsWith("plex:")
    ? selectedSource.slice(5)
    : "";
  const selectedSession = preferredRemoteSession(
    remote.sessions,
    requestedSessionId,
  );

  useEffect(() => {
    if (autoResolvedRef.current || selectedSource !== "auto" || remote.loading)
      return;
    autoResolvedRef.current = true;
    const playingRemote = remote.sessions.find((item) => item.playing);
    const next =
      localPlayer.currentTrack && localPlayer.isPlaying
        ? "local"
        : playingRemote
          ? `plex:${playingRemote.id}`
          : localPlayer.currentTrack
            ? "local"
            : remote.sessions[0]
              ? `plex:${remote.sessions[0].id}`
              : "local";
    setSelectedSource(next);
    localStorage.setItem("songlib-playback-source", next);
  }, [
    selectedSource,
    remote.loading,
    remote.sessions,
    localPlayer.currentTrack,
    localPlayer.isPlaying,
  ]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setClockNow(Date.now());
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    const ratingKey = selectedSession?.ratingKey;
    if (!ratingKey || selectedSource === "local") {
      setRemoteMetadata({});
      setMetadataLoading(false);
      return;
    }
    let cancelled = false;
    setRemoteMetadata({});
    setMetadataLoading(true);
    api(`/api/plex/items/${encodeURIComponent(ratingKey)}/playback`)
      .then((data) => !cancelled && setRemoteMetadata(data || {}))
      .catch(() => !cancelled && setRemoteMetadata({}))
      .finally(() => !cancelled && setMetadataLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.ratingKey, selectedSource]);

  const chooseSource = (source) => {
    if (source.startsWith("plex:") && localPlayer.isPlaying) {
      localPlayer.pause();
    }
    setSelectedSource(source);
    localStorage.setItem("songlib-playback-source", source);
    setControlMessage("");
    setTab("lyrics");
  };

  const remoteCommand = useCallback(
    async (action, value) => {
      if (!selectedSession?.clientId || !selectedSession.controllable) return;
      setControlBusy(action);
      setControlMessage("");
      try {
        await api(
          `/api/plex/remote/clients/${encodeURIComponent(selectedSession.clientId)}/commands`,
          {
            method: "POST",
            body: JSON.stringify({ action, value }),
          },
        );
        setControlMessage(
          ({
            play: "已发送播放命令",
            pause: "已发送暂停命令",
            previous: "已切换到上一首",
            next: "已切换到下一首",
            seek: "已更新播放进度",
            volume: "已调整设备音量",
          })[action] || "控制命令已发送",
        );
        window.setTimeout(() => remote.refresh({ quiet: true }), 350);
      } catch (error) {
        setControlMessage(error.message || "远程控制失败");
      } finally {
        setControlBusy("");
      }
    },
    [selectedSession?.clientId, selectedSession?.controllable, remote.refresh],
  );

  const usingRemote = selectedSource !== "local" && Boolean(selectedSession);
  useEffect(() => {
    if (selectedSession) setRemoteVolume(Number(selectedSession.volume ?? 100));
  }, [selectedSession?.id, selectedSession?.volume]);
  const track = usingRemote
    ? remoteTrack(selectedSession, remoteMetadata)
    : localPlayer.currentTrack;
  const remotePosition = remotePositionSeconds(
    selectedSession,
    remote.polledAt,
    clockNow,
  );
  const effectivePlayer = useMemo(
    () =>
      usingRemote
        ? {
            currentTime: remotePosition,
            duration: Number(selectedSession?.durationMs || 0) / 1000,
            isPlaying: Boolean(selectedSession?.playing),
            quality: selectedSession?.product || "Plex",
            canControl: Boolean(selectedSession?.controllable),
            canSeek: Boolean(selectedSession?.controllable),
            toggle: () =>
              remoteCommand(selectedSession?.playing ? "pause" : "play"),
            play: () => remoteCommand("play"),
            pause: () => remoteCommand("pause"),
            previous: () => remoteCommand("previous"),
            next: () => remoteCommand("next"),
            seek: (seconds) => remoteCommand("seek", Math.round(seconds * 1000)),
          }
        : {
            ...localPlayer,
            canControl: Boolean(localPlayer.currentTrack),
            canSeek: Boolean(localPlayer.currentTrack),
          },
    [
      usingRemote,
      remotePosition,
      selectedSession?.durationMs,
      selectedSession?.playing,
      selectedSession?.product,
      selectedSession?.controllable,
      localPlayer,
      remoteCommand,
    ],
  );

  const [fallbackLyrics, setFallbackLyrics] = useState("");
  const [lyricsError, setLyricsError] = useState("");
  useEffect(() => {
    setFallbackLyrics("");
    setLyricsError("");
    if (!track || String(track.lyrics || "").trim()) return;
    const key =
      track.sourceType === "plex_item" || track.sourceType === "plex_session"
        ? track.plexRatingKey || track.raw?.ratingKey
        : track.sourceType === "local_file"
          ? track.localFileId || track.raw?.id
          : "";
    if (!key) return;
    let cancelled = false;
    api(
      track.sourceType === "plex_item" || track.sourceType === "plex_session"
        ? `/api/player/plex/${encodeURIComponent(key)}/lyrics`
        : `/api/player/local/${encodeURIComponent(key)}/lyrics`,
    )
      .then((data) => !cancelled && setFallbackLyrics(String(data.lyrics || "")))
      .catch((error) => !cancelled && setLyricsError(error.message || "暂时无法获取歌词"));
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.lyrics, track?.sourceType, track?.plexRatingKey]);

  const lyricsText = String(track?.lyrics || fallbackLyrics || "").trim();
  const lyricsTrack = track ? { ...track, lyrics: lyricsText } : null;
  const lines = displayLyricsFor(lyricsTrack, parseLrc(lyricsText));
  const activeLine = lines.reduce(
    (current, line, index) =>
      line.time <= effectivePlayer.currentTime ? index : current,
    0,
  );
  const cast = useAirPlayLyricsCast({
    track: lyricsTrack,
    lyrics: lyricsText,
    player: effectivePlayer,
  });

  const cover = coverFor(track);
  const background = coverFor(track);
  const queue = usingRemote ? [] : localPlayer.queue || [];
  const liked = !usingRemote && track ? localPlayer.isFavorite(track) : false;
  const remoteIds = new Set(remote.sessions.map((session) => session.clientId));
  const idleClients = remote.clients
    .filter((client) => !remoteIds.has(client.id))
    .map((client) => ({ ...client, clientId: client.id, deviceName: client.name }));
  const sourceDescription = usingRemote
    ? `${selectedSession.deviceName} · ${remoteControlMessage(selectedSession)}`
    : track
      ? "此浏览器 · SongLib 本机播放器"
      : "此浏览器 · 当前没有播放内容";

  return (
    <div className="page now-playing-page" style={{ "--now-bg": `url(${background})` }}>
      <header className="now-page-head">
        {/* 这一页的主体是当前曲目，不是"正在播放"四个字。
            所以页面标题收成一行小标签，把视觉重量留给下面的歌名。
            重构前这里是 h1，而下面的歌名是 46px 的 h2 —— 层级是反的。 */}
        <div>
          <h1 className="now-page-title">正在播放</h1>
          <p>{sourceDescription}</p>
        </div>
        <div className="now-page-actions">
          {track ? (
            <AirPlayCastButton cast={cast} />
          ) : (
            /* 禁用态的按钮，title 在多数浏览器上不会浮出来，
               所以原因要写进无障碍名里。 */
            <button
              type="button"
              className="airplay-cast-button"
              disabled
              aria-label="投到电视：先选一首歌"
              title="先选一首歌"
            >
              <Airplay aria-hidden="true" />
              <span>投到电视</span>
            </button>
          )}
          <button className="now-device-shortcut" onClick={() => setTab("devices")}>
            <MonitorSpeaker />
            <span><small>播放来源</small><strong>{usingRemote ? selectedSession.deviceName : "此浏览器"}</strong></span>
            <ChevronRight />
          </button>
          <IconButton
            icon={RefreshCw}
            size="sm"
            label="刷新 Plex 播放设备"
            loading={remote.loading}
            onClick={() => remote.refresh()}
          />
        </div>
      </header>

      {remote.error && (
        <div className="now-notice warning" role="status">
          <CircleAlert /><span><strong>暂时无法读取 Plex 播放会话</strong><small>{remote.error}</small></span>
          <button onClick={() => remote.refresh()}>重试</button>
        </div>
      )}

      <section className={`now-workspace ${track ? "" : "empty"}`}>
        <article className="now-track-column">
          <div className="now-cover-wrap">
            <div className="now-cover">
              {track ? <img src={cover} alt={track.title || "专辑封面"} /> : <Disc3 />}
            </div>
            <span className={`now-source-chip ${usingRemote ? "remote" : ""}`}>
              <i />{usingRemote ? `跟随 ${selectedSession.product || "Plex"}` : "SongLib 本机播放"}
            </span>
          </div>
          {/* 同一个标题兼两职：有歌时它是曲名（页面主体，可以很大），
              没歌时它是一句提示（不该是页面主体）。
              用 data-empty 区分，字号在 now-playing.refresh.css 里分开给。 */}
          <div className="now-track-copy" data-empty={track ? undefined : "true"}>
            <h2>{track?.title || "先选一个播放来源"}</h2>
            <p>{track ? `${track.artist || "未知歌手"} · ${track.album || "未知专辑"}` : "在这个浏览器里放，或者跟着别的设备上的 Plexamp 一起听。"}</p>
            {track && (
              <div className="now-quality">
                <span>{usingRemote ? "PLEX" : effectivePlayer.quality === "original" ? "无损" : String(effectivePlayer.quality).toUpperCase()}</span>
                {usingRemote ? selectedSession.deviceName : "SongLib Amp"}
              </div>
            )}
          </div>

          {track ? (
            <div className="now-controls">
              <div className="now-progress">
                <span>{formatTime(effectivePlayer.currentTime)}</span>
                <ProgressSlider
                  player={effectivePlayer}
                  label="播放进度"
                  disabled={controlBusy === "seek"}
                />
                <span>{formatTime(effectivePlayer.duration)}</span>
              </div>
              <div className="now-main-controls">
                <button disabled={!effectivePlayer.canControl || Boolean(controlBusy)} onClick={effectivePlayer.previous} aria-label="上一首"><ChevronLeft /></button>
                <button className="now-play" disabled={!effectivePlayer.canControl || Boolean(controlBusy)} onClick={effectivePlayer.toggle} aria-label={effectivePlayer.isPlaying ? "暂停" : "播放"}>
                  {controlBusy === "play" || controlBusy === "pause" ? <LoaderCircle className="spin" /> : effectivePlayer.isPlaying ? <Pause /> : <Play />}
                </button>
                <button disabled={!effectivePlayer.canControl || Boolean(controlBusy)} onClick={effectivePlayer.next} aria-label="下一首"><ChevronRight /></button>
              </div>
              <div className="now-control-meta">
                {usingRemote ? (
                  <>
                    {selectedSession.controllable && (
                      <label>
                        <Volume2 />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={remoteVolume}
                          disabled={controlBusy === "volume"}
                          onChange={(event) => setRemoteVolume(Number(event.target.value))}
                          onPointerUp={() => remoteCommand("volume", remoteVolume)}
                          onKeyUp={() => remoteCommand("volume", remoteVolume)}
                          aria-label={`调整 ${selectedSession.deviceName} 音量`}
                        />
                      </label>
                    )}
                    <span className={selectedSession.controllable ? "ok" : "warning"}>
                      {selectedSession.controllable ? <Check /> : <CircleAlert />}
                      {remoteControlMessage(selectedSession)}
                    </span>
                  </>
                ) : (
                  <>
                    <label><Volume2 /><input type="range" min="0" max="1" step="0.01" value={localPlayer.volume} onChange={(event) => localPlayer.setVolume(event.target.value)} aria-label="音量" /></label>
                    <button className={liked ? "active" : ""} onClick={() => localPlayer.toggleFavorite(track)}><Heart />{liked ? "已喜欢" : "喜欢"}</button>
                  </>
                )}
                {/* 做海报和播放来源无关，本机和跟随 Plex 都能做，
                    所以放在 ternary 外面。 */}
                <button onClick={() => setPosterOpen(true)}>
                  <ImagePlus />
                  做分享图
                </button>
              </div>
              {controlMessage && <div className={`now-control-message ${/失败|无法|拒绝/.test(controlMessage) ? "error" : ""}`}>{controlMessage}</div>}
            </div>
          ) : (
            <div className="now-empty-actions">
              <Button variant="primary" icon={MonitorSpeaker} onClick={() => setTab("devices")}>
                选择播放来源
              </Button>
              <Button icon={Library} onClick={() => navigate("library")}>
                打开音乐库
              </Button>
            </div>
          )}
        </article>

        <section className="now-detail-panel">
          <nav className="now-tabs" aria-label="正在播放详情">
            <button className={tab === "lyrics" ? "active" : ""} onClick={() => setTab("lyrics")}><Mic2 />歌词投屏</button>
            <button className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}><MonitorSpeaker />播放来源<span>{remote.sessions.length}</span></button>
            <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}><ListMusic />待播队列</button>
          </nav>

          {tab === "lyrics" && (
            <div className="now-pane now-lyrics-pane">
              {metadataLoading ? (
                <div className="now-centered"><LoaderCircle className="spin" /><strong>正在读取歌曲与歌词</strong></div>
              ) : lines.length && playerSettings.showLyrics !== false ? (
                <div className="now-lyrics-lines">
                  {lines.map((line, index) => (
                    <button
                      key={`${line.time}-${index}`}
                      className={index === activeLine ? "active" : ""}
                      disabled={!effectivePlayer.canSeek}
                      onClick={() => effectivePlayer.seek(line.time)}
                    >
                      {line.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="now-centered">
                  <Mic2 /><strong>{lyricsError ? "歌词获取失败" : track ? "这首歌还没有可用歌词" : "选择正在播放的来源"}</strong>
                  <p>{lyricsError || (track ? "优先用歌曲旁边的 .lrc，没有再去线上找" : "挑一个设备，它在放什么、放到哪儿、歌词都会同步过来。")}</p>
                </div>
              )}
              <div className="now-cast-bar">
                <span><Airplay /><span><strong>歌词投到电视</strong><small>{track ? (usingRemote ? `从右上角投屏，音频继续由 ${selectedSession.deviceName} 播放` : "歌词投到电视上，声音还是这个浏览器出") : "先选一首正在播放的歌"}</small></span></span>
                <div className="now-cast-actions">
                  {/* 这里只保留歌词时间微调。投屏按钮在页头，
                      同一个动作不在一屏里出现两次。 */}
                  {track && (
                    /* 三个按钮原来只有 title。title 在触屏上根本不显示，
                       读屏器对它的支持也不一致 —— 图标按钮必须有 aria-label。
                       容器上那个 aria-label 也去掉了：div 不是交互元素，
                       给它加标签只会让读屏器多念一句没有用的话。 */
                    <div className="now-lyrics-offset" role="group" aria-label="歌词同步微调">
                      <button
                        type="button"
                        aria-label="歌词延后 0.25 秒"
                        title="歌词延后 0.25 秒"
                        onClick={() => cast.adjustLyricsOffset(-250)}
                      >
                        <Minus aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="value"
                        aria-label={`当前偏移 ${(cast.lyricsOffsetMs / 1000).toFixed(2)} 秒，点击归零`}
                        title="重置歌词同步"
                        onClick={cast.resetLyricsOffset}
                      >
                        {cast.lyricsOffsetMs > 0 ? "+" : ""}
                        {(cast.lyricsOffsetMs / 1000).toFixed(2)}s
                      </button>
                      <button
                        type="button"
                        aria-label="歌词提前 0.25 秒"
                        title="歌词提前 0.25 秒"
                        onClick={() => cast.adjustLyricsOffset(250)}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {track && (
                <button className="now-fullscreen-lyrics" disabled={!lines.length} onClick={() => setLyricsFull(true)}><Maximize2 />全屏歌词</button>
              )}
              {cast.message && <div className={`airplay-cast-status ${cast.wireless ? "active" : ""}`} role="status"><Airplay /><span>{cast.message}</span></div>}
            </div>
          )}

          {tab === "devices" && (
            <div className="now-pane">
              <div className="now-device-list">
                <button className={`now-device-row ${selectedSource === "local" ? "active" : ""}`} onClick={() => chooseSource("local")}>
                  <span className="now-device-icon"><Server /></span>
                  <span className="now-device-copy"><strong>此浏览器</strong><small>SongLib Amp · {localPlayer.currentTrack ? `${localPlayer.isPlaying ? "正在播放" : "已暂停"}《${localPlayer.currentTrack.title}》` : "当前没有播放内容"}</small></span>
                  <span className={`now-device-state ${localPlayer.currentTrack ? "" : "idle"}`}>{localPlayer.currentTrack ? "可控制" : "本机空闲"}</span>{selectedSource === "local" && <Check className="now-device-check" />}
                </button>
                {remote.sessions.map((session) => (
                  <DeviceRow key={session.id} session={session} active={usingRemote && selectedSession?.id === session.id} onSelect={() => chooseSource(`plex:${session.id}`)} />
                ))}
                {idleClients.map((client) => <DeviceRow key={client.id} session={client} active={false} onSelect={() => setControlMessage("这台设备现在没在放歌。先在它上面点开一首。")}/>) }
              </div>
              {!remote.loading && !remote.sessions.length && !idleClients.length && (
                <div className="now-centered compact"><MonitorSpeaker /><strong>没有发现 Plex 播放器</strong><p>打开 Plexamp，并在 Plex 设置里允许远程控制。</p></div>
              )}
              <div className="now-device-help"><CircleAlert /><span>挑一个来源。写着「仅跟随」的设备不接受遥控，但歌曲、进度和歌词照样同步。想投到 Apple TV 走上面的「歌词投屏」。</span></div>
            </div>
          )}

          {tab === "queue" && (
            <div className="now-pane">
              {usingRemote ? (
                <div className="now-centered"><ListMusic /><strong>正在跟随外部 Plexamp 队列</strong><p>Plex 不告诉我们它后面排了什么，所以这里列不出来。上一首、下一首照样能按。</p></div>
              ) : queue.length ? (
                <div className="now-queue-list">
                  {queue.map((item, index) => (
                    <button key={item.id || `${item.title}-${index}`} onClick={() => localPlayer.play(item, queue.slice(index + 1))}>
                      <span>{String(index + 1).padStart(2, "0")}</span><span><strong>{item.title || "未命名歌曲"}</strong><small>{item.artist || "未知歌手"}</small></span><time>{formatTime(item.duration)}</time>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="now-centered"><ListMusic /><strong>待播队列为空</strong><p>去音乐库挑几首，或者切到正在放歌的 Plexamp。</p><Button icon={Library} onClick={() => navigate("library")}>打开音乐库</Button></div>
              )}
            </div>
          )}
        </section>
      </section>

      <video
        ref={cast.videoRef}
        className={`airplay-cast-video ${cast.pickerOpen || cast.wireless ? "is-active" : ""}`}
        x-webkit-airplay="allow"
        playsInline
        muted
        autoPlay={cast.pickerOpen || cast.wireless}
        preload="none"
        disablePictureInPicture
        aria-label="Apple TV 歌词视频预览"
        aria-hidden="true"
      />
      {lyricsFull && track && (
        <LyricsOverlay track={lyricsTrack} lines={lines} activeLine={activeLine} player={effectivePlayer} cast={cast} onClose={() => setLyricsFull(false)} />
      )}
      {/* 传解析好的 lines 而不是 LRC 原文：海报要按句勾选，
          解析这件事已经在这一页做过一次了，不必再做一遍。 */}
      <PosterStudio
        open={posterOpen && Boolean(track)}
        onClose={() => setPosterOpen(false)}
        track={lyricsTrack}
        lyrics={lines}
      />
    </div>
  );
}
