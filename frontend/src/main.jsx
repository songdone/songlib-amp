import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { motion } from "motion/react";
import {
  Activity,
  Airplay,
  Album,
  ArrowLeft,
  ArrowDownToLine,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  Disc3,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  FileUp,
  FolderTree,
  Gauge,
  Home,
  Image,
  Fingerprint,
  Heart,
  KeyRound,
  Library,
  Link2,
  ListMusic,
  LoaderCircle,
  LogIn,
  LogOut,
  Maximize2,
  Menu,
  Music2,
  Palette,
  Pause,
  List,
  LocateFixed,
  Mic2,
  Play,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Repeat,
  RotateCcw,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Tags,
  TestTube2,
  Trash2,
  User,
  UserRound,
  UsersRound,
  Volume2,
  WandSparkles,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import "./commercial.css";
import "./liquid-glass.css";
import "./features/now-playing/now-playing.css";
import "./features/shell/shell-refactor.css";
import { BRAND } from "./config/brand";
import {
  playbackDurationSeconds,
  playlistPlaybackInput,
  playlistTrackPayload,
  recommendationPlaybackInput,
  servicePlaylistPlaybackItems,
} from "./lib/contracts";
import {
  knownPage,
  libraryDetailFromPath,
  libraryTabFromPath,
  pageFromPath,
  pathForLibraryDetail,
  pathForLibraryTab,
  pathForPage,
  pathForPlaylist,
  playlistIdFromPath,
} from "./lib/routes";
import {
  mobileNavigationIds,
  mobileNavigationTarget,
} from "./lib/navigation";
import { sourceCatalogReady } from "./lib/sources";
import { buildAmbientDeck } from "./lib/ambient";
import { pwaInstallGuidance, pwaSecureOrigin } from "./lib/pwa";
import {
  appearanceStyle,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolvedTheme,
} from "./lib/appearance";
import { clearFastCache, readFastCache, writeFastCache } from "./lib/cache";
import { api } from "./lib/api";
import { displayLyricsFor, parseLrc } from "./lib/lyrics";
import {
  AirPlayCastButton,
  useAirPlayLyricsCast,
} from "./features/airplay/AirPlayLyricsCast";
import NowPlayingPage from "./features/now-playing/NowPlayingPage";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

const nav = [
  { id: "home", label: "首页", icon: Home, group: "音乐" },
  { id: "library", label: "音乐库", icon: Library, group: "音乐" },
  { id: "player", label: "正在播放", icon: Play, group: "音乐" },
  { id: "playlists", label: "歌单", icon: ListMusic, group: "音乐" },
  { id: "manage", label: "音乐工具", icon: Gauge, group: "工具", admin: true },
  { id: "settings", label: "设置", icon: Settings, group: "系统" },
];

const managementNav = [
  {
    id: "local",
    label: "文件与标签",
    icon: FolderTree,
    desc: "浏览音乐文件、写入真实音频标签并撤销整理操作",
  },
  {
    id: "scrape",
    label: "Plex 元数据",
    icon: WandSparkles,
    desc: "歌手海报、背景、中文简介、专辑封面与歌词补齐",
  },
  {
    id: "download",
    label: "歌曲下载与入库",
    icon: ArrowDownToLine,
    desc: "下载到当前设备或 NAS，并完成标签与入库检查",
  },
  {
    id: "sources",
    label: "音乐源管理",
    icon: Wifi,
    desc: "添加授权来源并检查连接状态",
  },
  {
    id: "tasks",
    label: "任务中心",
    icon: Activity,
    desc: "运行中、待确认、失败与历史任务",
  },
  {
    id: "settings",
    label: "系统设置",
    icon: Settings,
    desc: "Plex、账号、安全、日志与偏好",
  },
];

const fmt = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);
const pct = (value, total) => (total ? Math.round((value / total) * 100) : 0);
const durationLabel = (value) => {
  const seconds = Math.floor(Number(value || 0) / 1000);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
};
const timeAgo = (value) => {
  if (!value) return "刚刚";
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
};

const VISUAL_FALLBACKS = Object.freeze({
  login: "/visuals/login-bg.jpg",
  artist: "/visuals/fallback-artist.svg",
  player: "/visuals/fallback-player.svg",
  cover: "/visuals/fallback-cover-vinyl.svg",
});

const coverUrlFor = (track) =>
  track?.albumCoverUrl ||
  track?.coverUrl ||
  track?.thumbUrl ||
  track?.raw?.coverUrl ||
  track?.raw?.thumbUrl ||
  "";

const normalizeTrackTitle = (value) =>
  String(value || "")
    .replace(/\.(flac|mp3|m4a|wav|ape|aac|ogg)$/i, "")
    .replace(/^\s*\d{1,3}\s*[-_.、]\s*/, "")
    .replace(/\s*[-_.\s]+(?:official\s*)?(?:music\s*)?(?:video|mv)\s*$/i, "")
    .replace(
      /\s*\[(?:mqms2|hi-?res|flac|320k|128k|official|无损|高品|mq)\]\s*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const trackIdentity = (track) => {
  if (!track) return "";
  if (track.canonicalKey) return track.canonicalKey;
  if (track.id) return String(track.id);
  if (track.ratingKey) return `plex-${track.ratingKey}`;
  if (track.plexRatingKey) return `plex-${track.plexRatingKey}`;
  if (track.localFileId) return `local-${track.localFileId}`;
  const title = normalizeTrackTitle(track.title || track.filename);
  return [
    track.sourceType || track.source || "local",
    title,
    track.artist || track.grandparentTitle || "",
    track.album || track.parentTitle || "",
  ]
    .join("|")
    .toLowerCase();
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => window.matchMedia?.(query)?.matches || false,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setMatches(media.matches);
    change();
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, [query]);
  return matches;
}

const isPlayableDuration = (track) => {
  const seconds = playbackDurationSeconds(track?.duration);
  if (!seconds) return true;
  return seconds > 5 && seconds < 60 * 60 * 6;
};

const sanitizeQueue = (items = [], current = null) => {
  const seen = new Set(current ? [trackIdentity(current)] : []);
  return (items || [])
    .filter(Boolean)
    .map((item) => ({
      ...item,
      duration: playbackDurationSeconds(item.duration),
    }))
    .filter((item) => {
      if (!isPlayableDuration(item)) return false;
      const key = trackIdentity(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const persistableTrack = (track) => {
  if (!track || track.sourceType === "source_preview") return null;
  const { audioUrl, transcodeUrls, raw, ...rest } = track;
  return rest;
};

const storedJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
};

const userIsAdmin = (user) => ["admin", "owner"].includes(user?.role);
const activeNavId = (active) =>
  active === "manage" ||
  managementNav.some((item) => item.id !== "settings" && item.id === active)
    ? "manage"
    : active === "discover"
      ? "home"
      : active === "me" || active === "search"
        ? "library"
        : active;

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <img className="brand-mark" src={BRAND.mark} alt="" />
      {!compact && (
        <div>
          <b>{BRAND.sidebarTitle}</b>
          <small>{BRAND.sidebarSlogan}</small>
        </div>
      )}
    </div>
  );
}

function AppBackdrop({
  image,
  variant = "default",
  fallback = VISUAL_FALLBACKS.artist,
}) {
  const resolved = image || fallback;
  return (
    <div className={`app-backdrop ${variant}`} aria-hidden="true">
      <img
        key={resolved}
        className="backdrop-image current"
        src={resolved}
        alt=""
        decoding="async"
      />
      <i className="backdrop-vignette" />
      <i className="backdrop-aurora" />
    </div>
  );
}

function LoginMotionBackdrop() {
  const particles = useMemo(
    () =>
      Array.from({ length: 60 }, (_, index) => ({
        id: index,
        left: `${(index * 37) % 100}%`,
        duration: 12 + ((index * 17) % 12),
        delay: (index * 29) % 15,
        x: Math.sin(index) * 120,
      })),
    [],
  );
  return (
    <div className="login-motion-bg" aria-hidden="true">
      <div className="login-base-map">
        <div className="login-base-vignette" />
      </div>
      <svg
        className="login-flow-lines"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            id="songlib-login-line-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0)" />
            <stop offset="50%" stopColor="rgba(245, 158, 11, 0.8)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 8 }, (_, index) => (
          <motion.path
            key={index}
            d={`M -10 ${20 + index * 15} Q ${40 + index * 5} ${30 - index * 5} ${70 + index * 10} ${50 + index * 10} T 110 ${40 + index * 10}`}
            fill="none"
            stroke="url(#songlib-login-line-gradient)"
            strokeWidth={0.55}
            strokeLinecap="round"
            strokeOpacity={0.42}
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0, pathOffset: 0 }}
            animate={{
              pathLength: [0, 0.18, 0.18, 0],
              opacity: [0, 0.42, 0.26, 0],
              pathOffset: [0, 0.18, 0.46, 0.72],
            }}
            transition={{
              duration: 26 + index * 4.5,
              repeat: Infinity,
              ease: "easeInOut",
              delay: index * 4.8,
            }}
          />
        ))}
      </svg>
      <div className="login-video-wrap">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="login-video"
          src="/visuals/songlib-login-background.mp4"
        />
      </div>
      <div className="login-gradient-top" />
      <div className="login-gradient-side" />
      <motion.div
        className="login-breath-glow top-left"
        animate={{ opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="login-breath-glow top-right"
        animate={{ opacity: [0.1, 0.5, 0.1] }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2,
        }}
      />
      <div className="login-dust">
        {particles.map((item) => (
          <motion.i
            key={item.id}
            style={{ left: item.left }}
            animate={{
              y: ["0vh", "-120vh"],
              x: [0, item.x],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: item.duration,
              repeat: Infinity,
              ease: "linear",
              delay: item.delay,
            }}
          />
        ))}
      </div>
      <div className="login-ambient-glow" />
      <motion.div
        className="login-card-glow"
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function LoginFeatureCard({ icon: Icon, title, desc, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      className="login-motion-feature"
    >
      <div>
        <Icon />
      </div>
      <section>
        <h4>{title}</h4>
        <p>{desc}</p>
      </section>
    </motion.div>
  );
}

function ArtistBackdrop({ imageUrl }) {
  return (
    <AppBackdrop
      image={imageUrl}
      variant="home artist-backdrop"
      fallback={VISUAL_FALLBACKS.artist}
    />
  );
}

function PlayerBackdrop({ imageUrl }) {
  return (
    <AppBackdrop
      image={imageUrl}
      variant="player player-backdrop"
      fallback={VISUAL_FALLBACKS.player}
    />
  );
}

function Spectrum({ bars = 42 }) {
  return (
    <div className="spectrum" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <i key={index} style={{ "--h": `${22 + ((index * 17) % 54)}%` }} />
      ))}
    </div>
  );
}

function PwaInstallPrompt() {
  const [event, setEvent] = useState(null),
    [visible, setVisible] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [status, setStatus] = useState("");
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone;
  const secureOrigin = pwaSecureOrigin({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    isSecureContext: window.isSecureContext,
  });
  const guidance = pwaInstallGuidance({
    hasPrompt: Boolean(event),
    secureOrigin,
    userAgent: window.navigator.userAgent,
  });
  useEffect(() => {
    if (standalone || localStorage.getItem("songlib-pwa-dismissed") === "1")
      return;
    const timer = setTimeout(() => setVisible(true), 2600);
    const onPrompt = (e) => {
      e.preventDefault();
      setEvent(e);
      setVisible(true);
      setHelpOpen(false);
      clearTimeout(timer);
    };
    const onInstalled = () => {
      setVisible(false);
      setEvent(null);
      localStorage.setItem("songlib-pwa-dismissed", "1");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [standalone]);
  if (!visible || standalone) return null;
  const install = async () => {
    if (event) {
      setStatus("");
      await event.prompt();
      const result = await event.userChoice.catch(() => ({
        outcome: "dismissed",
      }));
      setEvent(null);
      if (result.outcome === "accepted") {
        localStorage.setItem("songlib-pwa-dismissed", "1");
        setVisible(false);
      } else {
        setStatus("安装已取消。浏览器再次允许安装时，这里会重新出现安装入口。");
        setHelpOpen(true);
      }
    } else {
      setHelpOpen((value) => !value);
      setStatus("");
    }
  };
  const dismiss = () => {
    localStorage.setItem("songlib-pwa-dismissed", "1");
    setVisible(false);
  };
  return (
    <aside className="pwa-prompt panel">
      <button className="icon-button" onClick={dismiss}>
        <X />
      </button>
      <div className="pwa-icon">
        <img src="/icons/icon-192.png" alt="" />
      </div>
      <div>
        <strong>安装音屿轻应用</strong>
        <p>{guidance.summary}</p>
        {helpOpen && (
          <div className="pwa-install-help" role="status">
            {guidance.detail}
          </div>
        )}
        {status && <div className="pwa-install-status" role="status">{status}</div>}
        <div>
          <button className="primary small" onClick={install}>
            {event ? <Download /> : <BookOpenText />}
            {guidance.actionLabel}
          </button>
          <button className="secondary small" onClick={dismiss}>
            稍后再说
          </button>
        </div>
      </div>
    </aside>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page login-motion-page">
      <LoginMotionBackdrop />
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="login-motion-logo"
      >
        <div className="login-motion-logo-mark">
          <img src={BRAND.mark} alt="" />
        </div>
        <div>
          <h1>
            {BRAND.name}
            <span>|</span>
            {BRAND.cnName}
          </h1>
          <p>让散落的音乐 回到自己的岛屿</p>
        </div>
      </motion.div>

      <div className="login-motion-shell">
        <div className="login-motion-grid">
          <section className="login-motion-left">
            <div>
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="login-motion-copy"
              >
                <h3>
                  <span />
                  YOUR MUSIC, AT HOME
                </h3>
                <h2>
                  让散落的音乐,
                  <br />
                  回到自己的<span>岛屿。</span>
                </h2>
                <p>
                  一处收藏、整理和播放 NAS
                  里的音乐，也能与 Plex 保持同步。
                </p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                className="login-motion-features"
              >
                <LoginFeatureCard
                  delay={0.3}
                  icon={Server}
                  title="私人曲库"
                  desc="音乐始终留在家中"
                />
                <LoginFeatureCard
                  delay={0.4}
                  icon={Play}
                  title="连续播放"
                  desc="歌曲、队列与歌词相伴"
                />
                <LoginFeatureCard
                  delay={0.5}
                  icon={ShieldCheck}
                  title="本地优先"
                  desc="听歌记录由你掌控"
                />
                <LoginFeatureCard
                  delay={0.6}
                  icon={Activity}
                  title="为你发现"
                  desc="从熟悉走向新的旋律"
                />
              </motion.div>
            </div>
          </section>

          <section className="login-motion-right">
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.3,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="login-motion-card-group"
            >
              <div className="login-motion-hover-glow" />
              <div className="login-motion-card">
                <div className="login-motion-card-line" />
                <div className="login-motion-card-head">
                  <div>
                    <img src={BRAND.mark} alt="" />
                  </div>
                  <h2>
                    {BRAND.name}
                    <span>{BRAND.cnName}</span>
                  </h2>
                  <p>SECURE ACCESS</p>
                </div>

                <form className="login-motion-form" onSubmit={submit}>
                  <h3>登录控制台</h3>
                  <label>用户名</label>
                  <div className="login-motion-input">
                    <User />
                    <input
                      autoFocus
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="输入用户名"
                    />
                  </div>
                  <label>密码</label>
                  <div className="login-motion-input">
                    <KeyRound />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                  <div className="login-motion-row">
                    <span>会话仅保存在当前浏览器</span>
                    <button
                      type="button"
                      onClick={() =>
                        setError(
                          "请联系这台音屿实例的管理员，按部署文档中的“恢复管理员访问”流程重置密码。",
                        )
                      }
                    >
                      忘记密码？
                    </button>
                  </div>
                  {error && (
                    <div className="form-error login-motion-error">
                      <CircleAlert />
                      {error}
                    </div>
                  )}
                  <button
                    className="login-motion-submit"
                    disabled={busy || !password}
                  >
                    {busy ? <LoaderCircle className="spin" /> : <LogIn />}
                    进入音屿控制台
                  </button>
                </form>

                <footer>
                  <span className="status-dot" />
                  NAS 本地运行 · 数据不会上传云端
                </footer>
              </div>
            </motion.div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SetupWizard({ onComplete }) {
  const [form, setForm] = useState({
    username: "admin",
    displayName: "",
    password: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/setup/complete", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          displayName: form.displayName,
          password: form.password,
        }),
      });
      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup-page">
      <LoginMotionBackdrop />
      <section className="setup-card panel">
        <Brand />
        <span className="eyebrow"><ShieldCheck />首次设置</span>
        <h1>创建这座音乐岛的主人账号</h1>
        <p>账号、画像和播放记录只保存在这台设备。完成后可继续连接音乐目录或 Plex。</p>
        <form onSubmit={submit}>
          <label>
            <span>用户名</span>
            <input autoFocus value={form.username} onChange={(event) => update("username", event.target.value)} />
          </label>
          <label>
            <span>显示名称</span>
            <input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="例如：我的音屿" />
          </label>
          <label>
            <span>管理员密码</span>
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="至少 12 个字符" />
          </label>
          <label>
            <span>确认密码</span>
            <input type="password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} />
          </label>
          {error && <div className="form-error"><CircleAlert />{error}</div>}
          <button className="primary" disabled={busy || form.password.length < 12}>
            {busy ? <LoaderCircle className="spin" /> : <ChevronRight />}
            创建账号并进入
          </button>
        </form>
        <footer><ShieldCheck />不会创建默认弱密码，也不会把密码写入页面或日志。</footer>
      </section>
    </main>
  );
}

function SidebarMiniPlayer({ openPlayer }) {
  const player = usePlayer();
  const current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current) || VISUAL_FALLBACKS.cover;
  const title = current.title || "未命名歌曲";
  const artist = current.artist || "未知歌手";
  const progress = player.duration
    ? pct(player.currentTime, player.duration)
    : 0;
  const liked = player.isFavorite(current);
  return (
    <section className="sidebar-player" aria-label="侧边栏迷你播放器">
      <div className="sidebar-player-head">
        <button className="sidebar-player-cover" onClick={openPlayer}>
          {cover ? <img src={cover} alt="" /> : <Music2 />}
        </button>
        <div>
          <strong>{title}</strong>
          <span>{artist}</span>
        </div>
        <button
          className={`sidebar-like ${liked ? "active" : ""}`}
          aria-label={liked ? "取消喜欢" : "喜欢"}
          onClick={() => player.toggleFavorite(current)}
        >
          <Heart />
        </button>
      </div>
      <div className="sidebar-player-controls">
        <button onClick={player.previous} aria-label="上一首">
          <ChevronRight className="prev-icon" />
        </button>
        <button
          className="sidebar-play"
          onClick={player.toggle}
          aria-label={player.isPlaying ? "暂停" : "播放"}
        >
          {player.isPlaying ? <Pause /> : <Play />}
        </button>
        <button onClick={player.next} aria-label="下一首">
          <ChevronRight />
        </button>
      </div>
      <div className="sidebar-player-progress">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="sidebar-player-time">
        <span>{formatTime(player.currentTime)}</span>
        <span>{formatTime(player.duration)}</span>
      </div>
    </section>
  );
}

function Sidebar({
  active,
  onChange,
  open,
  close,
  logout,
  version,
  openPlayer,
  isAdmin = true,
}) {
  const visibleNav = nav.filter((item) => !item.admin || isAdmin);
  const highlighted = activeNavId(active);
  const groups = [...new Set(visibleNav.map((item) => item.group))];
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="icon-button mobile-only" onClick={close}>
            <X />
          </button>
        </div>
        <nav aria-label="主导航">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {visibleNav
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    className={highlighted === item.id ? "active" : ""}
                    onClick={() => {
                      onChange(item.id);
                      close();
                    }}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {highlighted === item.id && <i />}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <SidebarMiniPlayer openPlayer={openPlayer} />
          <div className="side-version">v{version || BRAND.version}</div>
          <button className="logout" onClick={logout}>
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      </aside>
      {open && <button className="backdrop mobile-only" onClick={close} />}
    </>
  );
}

function Topbar({ title, subtitle, openMenu, onNavigate, logout, profile }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const submitSearch = (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    onNavigate("search");
  };
  return (
    <header className="topbar">
      <button className="icon-button mobile-only" onClick={openMenu}>
        <Menu />
      </button>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="top-actions">
        <form className="top-search" onSubmit={submitSearch}>
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(e);
            }}
            placeholder="搜索音乐、艺术家、专辑…"
          />
          <kbd>↵</kbd>
        </form>
        <div
          className="brand-status"
          title={`${BRAND.fullName} · 音屿正在本地运行`}
          role="status"
          aria-label="音屿正在本地运行"
        >
          <img src={BRAND.mark} alt="" />
          <span />
        </div>
        <button
          className="icon-button notification"
          onClick={() => onNavigate("tasks")}
        >
          <Activity />
          <span />
        </button>
        <div className="user-entry">
          <button
            className="avatar"
            onClick={() => setOpen(!open)}
            aria-label="用户菜单"
          >
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              <UserRound />
            )}
            <ChevronDown />
          </button>
          {open && (
            <div className="user-menu panel">
              <strong>{profile?.displayName || "音屿控制台"}</strong>
              <button
                onClick={() => {
                  onNavigate("settings");
                  setOpen(false);
                }}
              >
                <UserRound />
                账号设置
              </button>
              <button
                onClick={() => {
                  onNavigate("settings");
                  setOpen(false);
                }}
              >
                <Settings />
                系统设置
              </button>
              <button onClick={logout}>
                <LogOut />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "amber",
  progress,
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{fmt(value)}</strong>
        <small>{detail}</small>
      </div>
      {progress !== undefined && (
        <div className="mini-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </article>
  );
}

function SectionHead({ title, note, action }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      {action}
    </div>
  );
}

function Empty({ icon: Icon = Music2, title, text }) {
  return (
    <div className="empty">
      <div>
        <Icon />
      </div>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}

function Dashboard({ stats, jobs, loading, navigate, runJob, isAdmin = true }) {
  const player = usePlayer();
  const [home, setHome] = useState({
    artists: [],
    albums: [],
    tracks: [],
    playlists: [],
    recommendations: [],
  });
  const [contentLoading, setContentLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      api("/api/library/artists?pageSize=12").catch(() => ({ items: [] })),
      api("/api/library/albums?pageSize=12").catch(() => ({ items: [] })),
      api("/api/library/tracks?pageSize=12").catch(() => ({ items: [] })),
      api("/api/playlists").catch(() => ({ items: [] })),
      api("/api/recommendations").catch(() => ({ items: [] })),
    ])
      .then(([artists, albums, tracks, playlists, recommendations]) =>
        setHome({
          artists: artists.items || [],
          albums: albums.items || [],
          tracks: tracks.items || [],
          playlists: playlists.items || [],
          recommendations: recommendations.items || [],
        }),
      )
      .finally(() => setContentLoading(false));
  }, []);
  if (loading) return <PageLoader />;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const history = (player.history || []).slice(0, 6);
  const continueItems = history.length ? history : home.tracks.slice(0, 6);
  const playItems = (items, index = 0) => {
    const playable = items
      .map((item) => ({
        ...item,
        source: item.source || (item.ratingKey ? "plex_item" : item.source),
      }))
      .filter((item) => item.ratingKey || item.audioUrl || item.path || item.file);
    if (playable[index]) player.play(playable[index], playable.slice(index + 1));
  };
  const openAlbum = async (album) => {
    const result = await api(
      `/api/library/albums/${encodeURIComponent(album.ratingKey)}`,
    );
    playItems(result.tracks || []);
  };
  const heroAlbum = home.albums[0];
  const heroArtist =
    home.artists.find(
      (artist) =>
        artist.ratingKey === heroAlbum?.parentRatingKey ||
        artist.title === heroAlbum?.parentTitle,
    ) || home.artists[0];
  const heroCover = heroArtist?.thumbUrl || heroAlbum?.thumbUrl || "";
  return (
    <div className="page dashboard-page home-v2">
      <header className="home-heading">
        <div>
          <span>{greeting}</span>
          <h1>听点喜欢的</h1>
        </div>
        <button className="home-search-shortcut" onClick={() => navigate("search")}>
          <Search />
          <span>搜索歌曲、艺人或专辑</span>
          <kbd>↵</kbd>
        </button>
      </header>

      <section className="home-focus">
        <div className="home-focus-copy">
          <span className="home-focus-label">最近加入</span>
          <h2>{heroAlbum?.title || "你的私人音乐库"}</h2>
          <p>
            {heroAlbum?.parentTitle || "随时从自己的 NAS 继续播放"}
            <span>
              {fmt(stats?.tracks || home.tracks.length)} 首歌曲 ·{" "}
              {fmt(stats?.albums || home.albums.length)} 张专辑
            </span>
          </p>
          <div className="home-focus-actions">
            <button
              className="primary home-play-button"
              disabled={!heroAlbum && !home.tracks.length}
              onClick={() => (heroAlbum ? openAlbum(heroAlbum) : playItems(home.tracks))}
            >
              <Play fill="currentColor" />
              播放
            </button>
            <button className="secondary" onClick={() => navigate("library")}>
              查看音乐库
            </button>
          </div>
        </div>
        <div className="home-focus-visual" aria-hidden="true">
          <span className="home-focus-shadow" />
          <span className="home-focus-disc">
            <i className="home-focus-grooves" />
            <span className="home-focus-cover">
              {heroCover ? <img src={heroCover} alt="" /> : <Disc3 />}
            </span>
            <b className="home-focus-spindle" />
          </span>
          <span className="home-focus-tonearm">
            <i />
            <b />
          </span>
        </div>
      </section>

      <SectionHead
        title="继续播放"
        action={
          <button className="text-button" onClick={() => navigate("me")}>
            播放记录
            <ChevronRight />
          </button>
        }
      />
      <section className="home-listening-grid">
        {continueItems.length ? (
          continueItems.map((item, index) => (
            <button
              className="continue-card"
              key={`${item.id || item.ratingKey || item.title}-${index}`}
              onClick={() => playItems(continueItems, index)}
            >
              <span className="continue-art">
                {coverUrlFor(item) ? <img src={coverUrlFor(item)} alt="" /> : <Music2 />}
                <i><Play fill="currentColor" /></i>
              </span>
              <span className="continue-copy">
                <strong>{item.title || "未命名歌曲"}</strong>
                <small>{item.artist || item.grandparentTitle || "未知艺人"}</small>
              </span>
              <span className="continue-time">{item.playedAt ? timeAgo(item.playedAt) : "播放"}</span>
            </button>
          ))
        ) : contentLoading ? (
          <PageLoader />
        ) : (
          <Empty icon={Music2} title="还没有播放记录" text="从音乐库挑一首开始吧。" />
        )}
      </section>

      <SectionHead
        title="最近加入"
        action={<button className="text-button" onClick={() => navigate("library")}>查看全部<ChevronRight /></button>}
      />
      <section className="home-album-grid">
        {home.albums.slice(0, 8).map((item) => (
          <button className="home-album-card" key={item.ratingKey} onClick={() => openAlbum(item)}>
            <span>
              {item.thumbUrl ? <img src={item.thumbUrl} alt="" /> : <Disc3 />}
              <i><Play fill="currentColor" /></i>
            </span>
            <strong>{item.title || "未命名专辑"}</strong>
            <small>{item.parentTitle || item.year || "未知艺人"}</small>
          </button>
        ))}
      </section>

      <div className="home-two-column">
        <section>
          <SectionHead
            title="你的歌单"
            action={<button className="text-button" onClick={() => navigate("playlists")}>全部歌单<ChevronRight /></button>}
          />
          <div className="home-playlist-stack">
            {home.playlists.slice(0, 4).map((item, index) => (
              <button key={item.id} onClick={() => navigate("playlists")}>
                <span className={`playlist-tile tone-${index % 4}`}><ListMusic /></span>
                <span><strong>{item.name}</strong><small>{item.itemCount || 0} 首歌曲</small></span>
                <ChevronRight />
              </button>
            ))}
            {!home.playlists.length && !contentLoading && (
              <button onClick={() => navigate("playlists")}>
                <span className="playlist-tile"><Plus /></span>
                <span><strong>创建第一张歌单</strong><small>也可导入 M3U 或平台分享链接</small></span>
                <ChevronRight />
              </button>
            )}
          </div>
        </section>
        <section>
          <SectionHead
            title="为你发现"
            action={<button className="text-button" onClick={() => navigate("discover")}>更多推荐<ChevronRight /></button>}
          />
          <div className="home-discovery-list">
            {home.recommendations.slice(0, 4).map((item, index) => (
              <button
                key={item.id || `${item.title}-${index}`}
                onClick={() => {
                  const target = recommendationPlaybackInput(item);
                  if (target) player.play(target);
                  else navigate("discover");
                }}
              >
                <span className="discovery-number">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{item.title}</strong><small>{item.artist || "未知艺人"}</small></span>
                <span className="discovery-reason">{(item.reasons || [item.inLibrary ? "曲库精选" : "新发现"])[0]}</span>
              </button>
            ))}
            {!home.recommendations.length && !contentLoading && (
              <button onClick={() => navigate("discover")}>
                <span className="discovery-number"><Sparkles /></span>
                <span><strong>开始形成你的推荐</strong><small>播放、收藏或跳过几首歌曲</small></span>
                <ChevronRight />
              </button>
            )}
          </div>
        </section>
      </div>

      {isAdmin && (stats.failedTasks > 0 || stats.waitingIngest > 0) && (
        <button className="home-admin-notice" onClick={() => navigate("manage")}>
          <CircleAlert />
          <span>
            <strong>有内容需要确认</strong>
            <small>
              {stats.waitingIngest || 0} 个待入库，{stats.failedTasks || 0} 个任务失败
            </small>
          </span>
          <ChevronRight />
        </button>
      )}
    </div>
  );
}

function JobRow({ job }) {
  const state = job.status;
  return (
    <div className="job-row">
      <div className={`job-state ${state}`}>
        {state === "running" ? (
          <LoaderCircle className="spin" />
        ) : state === "completed" ? (
          <Check />
        ) : state === "failed" ? (
          <CircleAlert />
        ) : (
          <Clock3 />
        )}
      </div>
      <div className="job-info">
        <div>
          <strong>{job.title}</strong>
          <span>{timeAgo(job.created_at)}</span>
        </div>
        <p>{job.message || (state === "queued" ? "等待执行" : "任务完成")}</p>
        {state === "running" && (
          <div className="bar">
            <i className="amber" style={{ width: `${job.progress}%` }} />
          </div>
        )}
      </div>
      <em>
        {state === "running"
          ? `${job.progress}%`
          : state === "completed"
            ? "完成"
            : state === "failed"
              ? "失败"
              : "排队"}
      </em>
    </div>
  );
}

function MediaLibrary({
  initialTab = "artists",
  initialDetail = null,
  play,
  previewBackdrop,
  onDetailBackdrop,
  onTabChange,
  onDetailChange,
}) {
  const [tab, setTab] = useState(initialTab);
  const [detail, setDetail] = useState(initialDetail);
  const [detailData, setDetailData] = useState(null);
  const [search, setSearch] = useState(
    () => localStorage.getItem("songlib-global-search") || "",
  );
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const libraryRequestRef = useRef(0);
  useEffect(() => {
    if (search) localStorage.removeItem("songlib-global-search");
  }, []);
  useEffect(() => {
    if (initialTab !== tab) setTab(initialTab);
  }, [initialTab]);
  useEffect(() => {
    setDetail(initialDetail);
  }, [initialDetail?.type, initialDetail?.ratingKey]);
  const load = async (requestId) => {
    setLoading(true);
    setLoadingMore(false);
    try {
      const first = await api(
        `/api/library/${tab}?page=1&pageSize=200&search=${encodeURIComponent(search)}`,
      );
      if (requestId !== libraryRequestRef.current) return;
      setData(first);
      setLoading(false);
      if (tab === "tracks" || first.items.length >= first.total) {
        return;
      }
      const pages = Math.ceil(first.total / first.pageSize);
      setLoadingMore(true);
      for (let page = 2; page <= pages; page += 4) {
        const batch = await Promise.all(
          Array.from(
            { length: Math.min(4, pages - page + 1) },
            (_, offset) =>
              api(
                `/api/library/${tab}?page=${page + offset}&pageSize=200&search=${encodeURIComponent(search)}`,
              ),
          ),
        );
        if (requestId !== libraryRequestRef.current) return;
        const items = batch.flatMap((result) => result.items || []);
        setData((value) => ({ ...first, items: [...value.items, ...items] }));
      }
    } finally {
      if (requestId === libraryRequestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };
  useEffect(() => {
    const requestId = ++libraryRequestRef.current;
    const timer = setTimeout(() => load(requestId), 180);
    return () => {
      clearTimeout(timer);
      if (libraryRequestRef.current === requestId)
        libraryRequestRef.current += 1;
    };
  }, [tab, search]);
  useEffect(() => {
    if (!detail?.ratingKey) {
      setDetailData(null);
      return;
    }
    let cancelled = false;
    setDetailData(null);
    api(
      `/api/library/${detail.type}/${encodeURIComponent(detail.ratingKey)}`,
    )
      .then((result) => {
        if (!cancelled) setDetailData(result);
      })
      .catch(() => {
        if (!cancelled) setDetailData({ error: "无法读取这项资料，请稍后重试。" });
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.type, detail?.ratingKey]);
  useEffect(() => {
    if (!detail) {
      onDetailBackdrop?.(null);
      return;
    }
    if (!detailData || detailData.error) return;
    const artist = detailData.artist;
    const subject =
      detail.type === "artists" ? detailData.artist : detailData.album;
    const imageUrl = artist?.backgroundUrl || VISUAL_FALLBACKS.artist;
    onDetailBackdrop?.({
      imageUrl,
      coverUrl: subject?.thumbUrl || artist?.thumbUrl || "",
      title: subject?.title || artist?.title || "",
      subtitle:
        detail.type === "artists" ? "当前歌手背景" : "当前专辑背景",
    });
  }, [
    detail?.type,
    detail?.ratingKey,
    detailData,
    onDetailBackdrop,
  ]);
  useEffect(
    () => () => {
      onDetailBackdrop?.(null);
    },
    [onDetailBackdrop],
  );
  const openDetail = (type, item) => {
    const next = { type, ratingKey: item.ratingKey };
    setDetail(next);
    onDetailChange?.(next);
  };
  const closeDetail = () => {
    setDetail(null);
    setDetailData(null);
    onDetailChange?.(null, tab);
  };
  const loadMore = async () => {
    if (loadingMore || data.items.length >= data.total) return;
    setLoadingMore(true);
    try {
      const page = Math.floor(data.items.length / 200) + 1;
      const next = await api(
        `/api/library/${tab}?page=${page}&pageSize=200&search=${encodeURIComponent(search)}`,
      );
      setData((value) => ({
        ...next,
        items: [...value.items, ...(next.items || [])],
      }));
    } finally {
      setLoadingMore(false);
    }
  };
  const showTracks = (item) => {
    setTab("tracks");
    setSearch(item.title || "");
    onTabChange?.("tracks");
  };
  const playFirst = async (item) => {
    const type = item.type === "artist" ? "artists" : "albums";
    const result = await api(
      `/api/library/${type}/${encodeURIComponent(item.ratingKey)}`,
    );
    const items = result.popularTracks || result.tracks || [];
    if (items[0])
      play?.(
        { ...items[0], source: "plex_item" },
        items.slice(1).map((track) => ({ ...track, source: "plex_item" })),
      );
  };
  if (detail) {
    return (
      <LibraryDetailPage
        type={detail.type}
        data={detailData}
        back={closeDetail}
        play={play}
        openDetail={openDetail}
      />
    );
  }
  return (
    <div className="page library-page">
      <div className="library-toolbar">
        <div className="segmented">
          {[
            ["artists", "歌手"],
            ["albums", "专辑"],
            ["tracks", "单曲"],
          ].map(([id, label]) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setDetail(null);
                onTabChange?.(id);
              }}
              key={id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`搜索${tab === "artists" ? "歌手" : tab === "albums" ? "专辑" : "单曲"}…`}
          />
        </div>
        <span className="result-count">
          {fmt(data.items.length)} / {fmt(data.total)} 项
        </span>
      </div>
      {loading ? (
        <PageLoader />
      ) : tab === "tracks" ? (
        <TrackTable items={data.items} play={play} />
      ) : (
        <div className="media-grid">
          {data.items.map((item) => (
            <MediaCard
              item={item}
              type={tab}
              key={item.ratingKey}
              showTracks={showTracks}
              playFirst={playFirst}
              openDetail={openDetail}
              previewBackdrop={previewBackdrop}
            />
          ))}
        </div>
      )}
      {!loading && data.items.length < data.total && (
        <div className="library-load-more">
          <button className="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <LoaderCircle className="spin" /> : <Plus />}
            {loadingMore
              ? `正在载入剩余 ${fmt(data.total - data.items.length)} 项`
              : `继续载入剩余 ${fmt(data.total - data.items.length)} 项`}
          </button>
        </div>
      )}
    </div>
  );
}

function MediaCard({
  item,
  type,
  showTracks,
  playFirst,
  openDetail,
  previewBackdrop,
}) {
  const isArtist = type === "artists";
  const isAlbum = type === "albums";
  const canBackdrop = isArtist && item.artUrl;
  return (
    <article
      className="media-card"
      role="button"
      tabIndex={0}
      onClick={() => openDetail?.(type, item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail?.(type, item);
        }
      }}
    >
      <div className="media-art">
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" loading="lazy" />
        ) : (
          <div className="art-placeholder">
            {isArtist ? <UserRound /> : <Disc3 />}
          </div>
        )}
        <div className="media-overlay media-actions">
          <button
            onClick={(event) => {
              event.stopPropagation();
              playFirst?.(item);
            }}
            title={isArtist ? "播放这个歌手的曲目" : "播放这张专辑"}
          >
            <Play fill="currentColor" />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              showTracks?.(item);
            }}
            title={isArtist ? "查看歌手曲目" : "查看专辑曲目"}
          >
            <ListMusic />
          </button>
          {canBackdrop && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                previewBackdrop?.({
                  imageUrl: item.artUrl,
                  coverUrl: item.thumbUrl || item.artUrl,
                  title: item.title,
                  subtitle: "手动选择的歌手背景",
                });
              }}
              title="用作当前背景"
            >
              <Image />
            </button>
          )}
        </div>
        {!item.hasCover && <span className="missing-badge">缺封面</span>}
        {item.hasBackground && <span className="background-badge">有背景</span>}
      </div>
      <h4>{item.title || "未命名"}</h4>
      <p>
        {isArtist
          ? `${(item.tags?.genre || []).slice(0, 2).join(" · ") || "音乐人"}`
          : item.parentTitle || item.year || "未知歌手"}
      </p>
      <div className="chips media-health-chips">
        <span>{item.synced ? "已同步" : "待同步"}</span>
        {isArtist && <span>{item.hasChineseBio ? "中文简介完整" : "缺中文简介"}</span>}
        {isArtist && <span>{item.hasBackground ? "背景完整" : "缺背景"}</span>}
      </div>
    </article>
  );
}

function LibraryDetailPage({ type, data, back, play, openDetail }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const detailKey =
    data?.artist?.ratingKey || data?.album?.ratingKey || "";
  useEffect(() => setSummaryExpanded(false), [detailKey]);
  if (!data) return <PageLoader />;
  if (data.error)
    return (
      <div className="page library-detail-page">
        <button className="detail-back" onClick={back}>
          <ArrowLeft />
          返回音乐库
        </button>
        <Empty icon={CircleAlert} title="资料暂时不可用" text={data.error} />
      </div>
    );
  const isArtist = type === "artists";
  const subject = isArtist ? data.artist : data.album;
  const tracks = isArtist ? data.popularTracks || [] : data.tracks || [];
  const albums = isArtist ? data.albums || [] : [];
  const playAll = () => {
    if (!tracks.length) return;
    play?.(
      { ...tracks[0], source: "plex_item" },
      tracks.slice(1).map((item) => ({ ...item, source: "plex_item" })),
    );
  };
  const playAlbum = async (album) => {
    const result = await api(
      `/api/library/albums/${encodeURIComponent(album.ratingKey)}`,
    );
    const items = result.tracks || [];
    if (!items.length) return;
    play?.(
      { ...items[0], source: "plex_item" },
      items.slice(1).map((item) => ({ ...item, source: "plex_item" })),
    );
  };
  return (
    <div
      className={`page library-detail-page ${
        isArtist ? "artist-profile-page" : "album-profile-page"
      }`}
    >
      <button className="detail-back" onClick={back}>
        <ArrowLeft />
        返回{isArtist ? "歌手" : "专辑"}
      </button>
      <section
        className={`library-detail-hero ${
          isArtist ? "artist-detail-hero" : "album-detail-hero"
        }`}
      >
        <div className="library-detail-content">
          <div className="library-detail-cover">
            {subject?.thumbUrl ? (
              <img src={subject.thumbUrl} alt="" />
            ) : isArtist ? (
              <UserRound />
            ) : (
              <Disc3 />
            )}
          </div>
          <div className="library-detail-copy">
            <span>{isArtist ? "艺人" : "专辑"}</span>
            <h1>{subject?.title || "未命名"}</h1>
            <p className="library-detail-meta">
              {isArtist
                ? [
                    ...(subject?.tags?.genre || []).slice(0, 3),
                    `${data.albumCount || albums.length} 张专辑`,
                    `${data.trackCount || tracks.length} 首歌曲`,
                  ].join(" · ")
                : [
                    subject?.parentTitle || data.artist?.title,
                    subject?.year,
                    `${data.trackCount || tracks.length} 首歌曲`,
                    durationLabel(data.duration),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            <div className="library-detail-actions">
              <button className="primary" onClick={playAll} disabled={!tracks.length}>
                <Play fill="currentColor" />
                播放
              </button>
              {!isArtist && data.artist?.ratingKey && (
                <button
                  className="secondary"
                  onClick={() => openDetail?.("artists", data.artist)}
                >
                  <UserRound />
                  查看艺人
                </button>
              )}
            </div>
            {subject?.summary && (
              <div className="library-detail-biography">
                <p
                  className={`library-detail-summary ${
                    summaryExpanded ? "expanded" : ""
                  }`}
                >
                  {subject.summary}
                </p>
                {subject.summary.length > 120 && (
                  <button
                    className="summary-toggle"
                    onClick={() => setSummaryExpanded((value) => !value)}
                    aria-expanded={summaryExpanded}
                  >
                    {summaryExpanded ? "收起介绍" : "查看全部"}
                    <ChevronDown
                      className={summaryExpanded ? "rotate-180" : ""}
                    />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <SectionHead
        title={isArtist ? "热门曲目" : "曲目"}
        note={
          isArtist
            ? "根据 Plex 播放数据排列"
            : `${data.trackCount || tracks.length} 首 · ${durationLabel(data.duration)}`
        }
      />
      <TrackTable items={tracks} play={play} />
      {isArtist && (
        <>
          <SectionHead title={`${data.albumCount || albums.length} 张专辑`} />
          <div className="media-grid detail-album-grid">
            {albums.map((item) => (
              <MediaCard
                item={item}
                type="albums"
                key={item.ratingKey}
                openDetail={openDetail}
                playFirst={playAlbum}
                showTracks={(album) => openDetail?.("albums", album)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TrackTable({ items, play }) {
  return (
    <div className="track-table panel">
      <div className="track-head">
        <span>#</span>
        <span>标题</span>
        <span>歌手</span>
        <span>专辑</span>
        <span>时长</span>
      </div>
      {items.map((item, index) => (
        <button
          className="track-row track-button"
          key={item.ratingKey}
          onClick={() =>
            play?.(
              { ...item, source: "plex_item" },
              items
                .slice(index + 1)
                .map((track) => ({ ...track, source: "plex_item" })),
            )
          }
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span className="track-title">
            <div>
              <Music2 />
            </div>
            <b>{item.title}</b>
          </span>
          <span>{item.grandparentTitle || item.originalTitle || "—"}</span>
          <span>{item.parentTitle || "—"}</span>
          <span>
            {item.duration
              ? `${Math.floor(item.duration / 60000)}:${String(Math.floor(item.duration / 1000) % 60).padStart(2, "0")}`
              : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}

function LocalLibraryPage({ runJob, play, notify, navigate }) {
  const [tab, setTab] = useState("files"),
    [data, setData] = useState({ items: [], total: 0, stats: {} }),
    [search, setSearch] = useState(
      () => localStorage.getItem("songlib-global-search") || "",
    ),
    [missing, setMissing] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState([]),
    [previews, setPreviews] = useState([]),
    [editing, setEditing] = useState(null),
    [operations, setOperations] = useState([]),
    [error, setError] = useState("");
  const [categories, setCategories] = useState({ summary: [], groups: {} });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [activeFilter, setActiveFilter] = useState(null);
  useEffect(() => {
    if (search) localStorage.removeItem("songlib-global-search");
  }, []);
  const load = async () => {
    setLoading(true);
    try {
      setData(
        await api(
          `/api/local/files?limit=${pageSize}&offset=${(page - 1) * pageSize}&search=${encodeURIComponent(search)}&missing=${missing}`,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [search, missing, page, pageSize]);
  const toggle = (id) =>
    setSelected((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  const preview = async () => {
    if (!selected.length) return;
    try {
      const result = await api("/api/local/organize/preview", {
        method: "POST",
        body: JSON.stringify({ fileIds: selected }),
      });
      setPreviews(result.items);
      setTab("preview");
    } catch (err) {
      setError(err.message);
    }
  };
  const apply = async () => {
    if (!previews.length) return;
    if (
      !confirm(
        `确认按预览结果整理 ${previews.length} 个文件？\n\n执行前请确认目标路径无误，操作会写入回滚记录。`,
      )
    )
      return;
    try {
      await api("/api/local/organize/apply", {
        method: "POST",
        body: JSON.stringify({ previews }),
      });
      notify("整理任务已加入队列");
      navigate("tasks");
    } catch (err) {
      setError(err.message);
    }
  };
  const saveTags = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes = Object.fromEntries(form.entries());
    try {
      await api(`/api/local/files/${editing.id}/tags`, {
        method: "PATCH",
        body: JSON.stringify({ changes }),
      });
      setEditing(null);
      notify("标签已写入音频文件");
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const switchTab = async (value) => {
    setTab(value);
    if (value === "history")
      try {
        setOperations(await api("/api/local/operations"));
      } catch (err) {
        setError(err.message);
      }
    if (value === "categories")
      try {
        setCategories(await api("/api/local/categories"));
      } catch (err) {
        setError(err.message);
      }
  };
  const applyCategory = (item, type, label) => {
    setMissing(item.missing || "");
    setSearch(item.search || item.name || "");
    setPage(1);
    setActiveFilter({
      type: label || type,
      name: item.name,
      missing: item.missing || "",
    });
    setTab("files");
  };
  const clearFilter = () => {
    setSearch("");
    setMissing("");
    setActiveFilter(null);
    setPage(1);
  };
  const rollback = async (item) => {
    if (!confirm("确认回滚这次操作？音屿会检查路径冲突后再执行。")) return;
    try {
      await api(`/api/local/operations/${item.id}/rollback`, {
        method: "POST",
      });
      setOperations(await api("/api/local/operations"));
      notify("操作已安全回滚");
    } catch (err) {
      setError(err.message);
    }
  };
  const stats = data.stats || {};
  return (
    <div className="page local-page">
      <section className="local-hero panel">
        <div>
          <span className="eyebrow">
            <FolderTree />
            NAS MUSIC LIBRARY
          </span>
          <h1>让每一首歌都有清晰的位置。</h1>
          <p>浏览曲库，校对标签和目录，需要时可安全撤销。</p>
        </div>
        <div>
          <button className="secondary" onClick={() => runJob("plex_sync")}>
            <RefreshCw />
            同步 Plex 对照
          </button>
          <button className="primary" onClick={() => runJob("local_scan")}>
            <FolderTree />
            扫描本地曲库
          </button>
        </div>
      </section>
      <div className="local-stats">
        <StatCard icon={FileAudio} label="本地音频" value={stats.total} />
        <StatCard
          icon={Image}
          label="缺封面"
          value={stats.missing_cover}
          tone="violet"
        />
        <StatCard
          icon={BookOpenText}
          label="缺歌词"
          value={stats.missing_lyrics}
          tone="blue"
        />
        <StatCard
          icon={CircleAlert}
          label="目录待整理"
          value={stats.bad_path}
          tone="amber"
        />
      </div>
      <div className="local-tabs">
        {[
          ["files", "文件浏览"],
          ["categories", "分类浏览"],
          ["missing", "缺失信息"],
          ["preview", "入库预览"],
          ["history", "操作历史"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => switchTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {tab === "files" && (
        <section className="panel local-workspace">
          {activeFilter && (
            <div className="library-context">
              <span>分类浏览</span>
              <ChevronRight />
              <span>{activeFilter.type}</span>
              <ChevronRight />
              <strong>{activeFilter.name}</strong>
              <button onClick={clearFilter}>
                {activeFilter.type}={activeFilter.name}
                <X />
              </button>
            </div>
          )}
          <div className="local-toolbar">
            <div className="search-field">
              <Search />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setActiveFilter(null);
                }}
                placeholder="搜索文件、歌曲、歌手或专辑…"
              />
            </div>
            <span>{data.total} 个真实文件</span>
            <button
              className="secondary small"
              disabled={!selected.length}
              onClick={preview}
            >
              <WandSparkles />
              整理预览 ({selected.length})
            </button>
          </div>
          {loading ? (
            <PageLoader />
          ) : (
            <div className="local-table">
              <div className="local-row local-head">
                <span></span>
                <span>歌曲 / 文件</span>
                <span>歌手</span>
                <span>专辑</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {data.items.map((item) => (
                <div className="local-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <div className="local-title">
                    <strong>{item.title || item.filename}</strong>
                    <small>{item.path}</small>
                  </div>
                  <span>{item.artist || "未知歌手"}</span>
                  <span>{item.album || "未知专辑"}</span>
                  <div className="file-flags">
                    <i className={item.has_cover ? "ok" : ""}>封面</i>
                    <i className={item.has_lrc ? "ok" : ""}>歌词</i>
                    <i className={item.plex_matched ? "ok" : ""}>Plex</i>
                  </div>
                  <div className="row-actions">
                    <button title="播放" onClick={() => play(item)}>
                      <Play />
                    </button>
                    <button title="编辑标签" onClick={() => setEditing(item)}>
                      <Tags />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && data.total > pageSize && (
            <div className="pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span>
                第 {page} / {Math.ceil(data.total / pageSize)} 页
              </span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value="30">每页 30 首</option>
                <option value="50">每页 50 首</option>
                <option value="100">每页 100 首</option>
              </select>
              <button
                disabled={page >= Math.ceil(data.total / pageSize)}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}
      {tab === "missing" && (
        <section className="panel missing-workspace">
          <SectionHead
            title="缺失信息扫描"
            note="筛选真实文件，不修改 Plex 条目"
          />
          <div className="missing-filters">
            {[
              ["cover", "缺封面", stats.missing_cover],
              ["lyrics", "缺歌词", stats.missing_lyrics],
              ["artist", "缺歌手", stats.missing_artist],
              ["album", "缺专辑", stats.missing_album],
              ["path", "目录不规范", stats.bad_path],
              ["plex", "Plex 未识别", stats.plex_unmatched],
            ].map(([id, label, count]) => (
              <button
                className={missing === id ? "active" : ""}
                onClick={() => {
                  setMissing(id);
                  setActiveFilter({
                    type: "缺失信息",
                    name: label,
                    missing: id,
                  });
                  setPage(1);
                  setTab("files");
                }}
                key={id}
              >
                <b>{count || 0}</b>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {tab === "categories" && (
        <section className="panel category-workspace">
          <SectionHead
            title="曲库分类"
            note="选择分类后可继续筛选、播放或编辑，返回时保留分类上下文。"
          />
          <div className="category-summary">
            {(categories.summary || []).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "tracks") clearFilter();
                  else setActiveFilter(null);
                  setTab(item.id === "tracks" ? "files" : "categories");
                }}
              >
                <strong>{fmt(item.count)}</strong>
                <span>{item.label}</span>
                <small>{item.note}</small>
              </button>
            ))}
          </div>
          <div className="category-groups">
            {[
              ["genre", "流派 / 风格"],
              ["artist", "艺人"],
              ["album", "专辑"],
              ["folder", "顶层文件夹"],
              ["format", "文件格式"],
              ["quality", "音质规格"],
              ["year", "年份"],
              ["scene", "场景精选"],
              ["missing", "待修复"],
            ].map(([key, title]) => (
              <div className="category-group" key={key}>
                <h3>{title}</h3>
                <div>
                  {(categories.groups?.[key] || []).map((item) => (
                    <button
                      key={item.id || item.name}
                      onClick={() => applyCategory(item, key, title)}
                    >
                      <span>{item.name}</span>
                      <b>{fmt(item.count)}</b>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "preview" && (
        <section className="panel preview-workspace">
          <SectionHead
            title="整理预览"
            note="确认前不会移动任何文件"
            action={
              previews.length ? (
                <button className="primary" onClick={apply}>
                  <Check />
                  确认执行
                </button>
              ) : null
            }
          />
          {previews.length ? (
            <div className="preview-list">
              {previews.map((item) => (
                <div key={item.fileId}>
                  <div>
                    <small>原路径</small>
                    <code>{item.sourcePath}</code>
                  </div>
                  <ChevronRight />
                  <div>
                    <small>新路径</small>
                    <code>{item.targetPath}</code>
                  </div>
                  <i className={item.conflict ? "danger" : "safe"}>
                    {item.conflict ? "存在冲突" : "安全"}
                  </i>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={WandSparkles}
              title="暂无整理预览"
              text="在文件浏览中勾选歌曲，再点击“整理预览”。"
            />
          )}
        </section>
      )}
      {tab === "history" && (
        <section className="panel operation-workspace">
          <SectionHead
            title="操作历史"
            note="标签写入、移动和下载入库均有回滚数据"
          />
          <div className="operation-list">
            {operations.length ? (
              operations.map((item) => (
                <div key={item.id}>
                  <span>{item.action}</span>
                  <code>{item.target_id || "—"}</code>
                  <i>{item.rollbackable ? "可回滚" : "仅记录"}</i>
                  <time>{timeAgo(item.created_at)}</time>
                  {item.rollbackable ? (
                    <button onClick={() => rollback(item)}>
                      <RotateCcw />
                      回滚
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <Empty
                icon={RotateCcw}
                title="暂无修改记录"
                text="完成标签写入、文件整理或入库后，记录会显示在这里。"
              />
            )}
          </div>
        </section>
      )}
      {editing && (
        <div className="modal-wrap">
          <button className="modal-backdrop" onClick={() => setEditing(null)} />
          <form className="modal panel tag-modal" onSubmit={saveTags}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">AUDIO TAGS</span>
                <h3>{editing.filename}</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(null)}
              >
                <X />
              </button>
            </div>
            <div className="tag-grid">
              {[
                ["title", "标题"],
                ["artist", "歌手"],
                ["album", "专辑"],
                ["albumArtist", "专辑艺术家"],
                ["year", "年份"],
                ["trackNumber", "音轨号"],
                ["discNumber", "碟号"],
                ["genre", "流派"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    defaultValue={
                      editing[key] ||
                      editing[
                        key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())
                      ] ||
                      ""
                    }
                  />
                </label>
              ))}
            </div>
            <p className="modal-note">
              <ShieldCheck />
              保存会直接写入真实音频标签，并记录可回滚的旧值。
            </p>
            <button className="primary full">
              <Tags />
              确认写入标签
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function DiscoverPage({ play, navigate, isAdmin = true }) {
  const [feed, setFeed] = useState({ categories: [], playlists: [] }),
    [category, setCategory] = useState("热门"),
    [detail, setDetail] = useState(null),
    [detailPage, setDetailPage] = useState(1);
  const [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [error, setError] = useState(""),
    [queueing, setQueueing] = useState(false);
  const loadFeed = async (name) => {
    setLoading(true);
    setError("");
    try {
      const data = await api(
        `/api/discovery/playlists?category=${encodeURIComponent(name || "热门")}`,
      );
      setFeed(data);
      setCategory(data.selectedCategory || name || "热门");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadFeed("热门");
  }, []);
  const openPlaylist = async (item) => {
    setDetailLoading(true);
    setError("");
    setDetailPage(1);
    try {
      setDetail(await api(`/api/discovery/playlists/${item.id}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };
  const playMatched = (track) => track?.localTrack && play(track.localTrack);
  const locateMatched = async (track) => {
    const resources = track?.localTrack?.resources || [];
    const local = resources.find((item) => item.type === "local_file");
    if (local?.path) {
      await navigator.clipboard?.writeText(local.path);
      return;
    }
    const plexResource = resources.find((item) => item.type === "plex_item");
    if (plexResource?.id) {
      const info = await api(`/api/plex/items/${plexResource.id}/playback`);
      if (info.openPlexUrl) window.open(info.openPlexUrl, "_blank");
    }
  };
  const queueMissing = async () => {
    const tracks = (detail?.tracks || []).filter((item) => item.canDownload);
    if (!tracks.length || !detail.downloadSource) return;
    setQueueing(true);
    setError("");
    try {
      const result = await api("/api/discovery/download-missing", {
        method: "POST",
        body: JSON.stringify({
          sourceId: detail.downloadSource.id,
          quality: "320k",
          tracks,
        }),
      });
      if (result.created) {
        navigate?.("tasks");
      } else setError(result.errors?.[0]?.error || "没有可加入的下载候选");
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  };
  const categories = feed.categories || [],
    playlists = feed.playlists || [];
  const detailPageSize = 50;
  const detailTracks = detail?.tracks || [];
  const detailPages = Math.max(
    1,
    Math.ceil(detailTracks.length / detailPageSize),
  );
  const visibleDetailTracks = detailTracks.slice(
    (detailPage - 1) * detailPageSize,
    detailPage * detailPageSize,
  );
  return (
    <div className="page discover-page">
      <section className="page-intro">
        <span className="eyebrow">
          <Sparkles />
          MUSIC DISCOVERY
        </span>
        <h1>
          从歌单发现，<span>在自己的曲库里播放。</span>
        </h1>
        <p>浏览热门歌单，已经收藏在曲库里的歌曲可以直接播放。</p>
      </section>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <div className="discover-layout">
        <section className="panel discover-panel playlist-taxonomy">
          <SectionHead
            title="歌单分类"
            note={
              feed.source === "netease-hottags"
                ? "网易云音乐公开分类"
                : "平台暂时不可用"
            }
          />
          <div className="playlist-tags">
            {categories.map((item) => (
              <button
                className={category === item.name ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setDetail(null);
                  setDetailPage(1);
                  loadFeed(item.name);
                }}
              >
                <span>{item.name}</span>
                {item.count ? <b>{fmt(item.count)}</b> : null}
              </button>
            ))}
          </div>
        </section>
        <section className="panel discover-panel">
          <SectionHead
            title={`${category}歌单`}
            note="选择歌单后查看本地匹配结果"
          />
          {loading ? (
            <PageLoader />
          ) : playlists.length ? (
            <div className="playlist-card-grid">
              {playlists.map((item) => (
                <button key={item.id} onClick={() => openPlaylist(item)}>
                  <div>
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" />
                    ) : (
                      <ListMusic />
                    )}
                  </div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.creator} · {fmt(item.trackCount)} 首
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={Radio}
              title="暂时没有读到歌单"
              text="稍后刷新分类；本地曲库和播放器不受影响。"
            />
          )}
        </section>
        {(detailLoading || detail) && (
          <section className="panel discover-panel playlist-detail">
            <SectionHead
              title={detail?.playlist?.title || "正在读取歌单"}
              note={
                detail
                  ? `${detail.summary.matched} 首已匹配 · ${detail.summary.downloadable} 首可下载 · ${detail.summary.unavailable} 首无法识别`
                  : ""
              }
              action={
                detail && isAdmin && detail.summary.downloadable ? (
                  <button
                    className="primary small"
                    disabled={queueing}
                    onClick={queueMissing}
                  >
                    {queueing ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <Download />
                    )}
                    批量加入下载
                  </button>
                ) : null
              }
            />
            {detailLoading ? (
              <PageLoader />
            ) : (
              <div className="playlist-match-table">
                {visibleDetailTracks.map((item, index) => (
                  <div key={`${item.platformTrackId}-${index}`}>
                    <span>
                      {String(
                        (detailPage - 1) * detailPageSize + index + 1,
                      ).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                      </small>
                    </div>
                    <i className={item.matchStatus}>
                      {item.matchStatus === "matched"
                        ? `已匹配 · ${item.localTrack?.sourceSummary || "本地"}`
                        : item.canDownload
                          ? "可下载"
                          : "无法识别"}
                    </i>
                    {item.matchStatus === "matched" ? (
                      <div className="inline-task-actions">
                        <button onClick={() => playMatched(item)}><Play />播放</button>
                        <button onClick={() => locateMatched(item)}><LocateFixed />{item.localTrack?.sourceTypes?.includes("local_file") ? "复制路径" : "打开 Plex"}</button>
                      </div>
                    ) : item.canDownload && isAdmin ? (
                      <button
                        onClick={() => {
                          localStorage.setItem(
                            "songlib-download-query",
                            `${item.title} ${item.artist}`,
                          );
                          navigate?.("download");
                        }}
                      >
                        <Download />
                        下载
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            )}
            {!detailLoading && detailTracks.length > detailPageSize && (
              <div className="pagination">
                <button
                  className="secondary small"
                  disabled={detailPage <= 1}
                  onClick={() => setDetailPage((value) => value - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {detailPage} / {detailPages} 页 · 共 {detailTracks.length}{" "}
                  首
                </span>
                <button
                  className="secondary small"
                  disabled={detailPage >= detailPages}
                  onClick={() => setDetailPage((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

const PlayerContext = createContext(null);
const usePlayer = () => useContext(PlayerContext);

const sourceLabel = (sourceType) =>
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

function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const hydratedRef = useRef(false);
  const progressMilestoneRef = useRef(0);
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
    quality: "original",
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
            const restored = await toPlaybackTrack(
              remote.currentTrack,
              "original",
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
    try {
      const immediate = immediatePlaybackTrack(input, state.quality);
      if (immediate) {
        if (!isPlayableDuration(immediate))
          throw new Error("这首歌的时长异常，已阻止播放并避免污染队列。");
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
              error: err.message || "浏览器阻止了自动播放，请再点一次播放。",
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
          "没有拿到可播放地址。若你通过 HTTPS 访问，请确认已使用音屿同源代理播放流。",
        );
      if (!isPlayableDuration(track))
        throw new Error("这首歌的时长异常，已阻止播放并避免污染队列。");
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
          error: "还没有播放内容。可以先随机播放、打开音乐库或查看今日推荐。",
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
    setState((s) => ({ ...s, quality }));
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
      if (!isPlayableDuration(track)) throw new Error("时长异常，已跳过。");
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
  const value = {
    ...state,
    audioRef,
    history,
    playEvents,
    playlists,
    favorites,
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
    setPlayMode,
    isFavorite,
    toggleFavorite,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    clear,
  };
  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        className="global-audio"
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
          const duration = Number.isFinite(e.currentTarget.duration)
            ? e.currentTarget.duration
            : 0;
          setState((s) => ({ ...s, duration: duration || s.duration }));
        }}
        onError={(e) => {
          const error = e.currentTarget.error;
          const messages = {
            1: "播放已中止",
            2: "音频连接中断，请稍后重试",
            3: "音频格式无法解码",
            4: "当前音频地址或格式不可播放",
          };
          setState((s) => ({
            ...s,
            isPlaying: false,
            error: messages[error?.code] || "音频暂时无法播放，请稍后重试",
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
    </PlayerContext.Provider>
  );
}

function PlayerPage({ navigate, playerSettings = {}, isAdmin = true }) {
  const player = usePlayer(),
    current = player.currentTrack;
  const [lyricsFull, setLyricsFull] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [resolvedLyrics, setResolvedLyrics] = useState("");
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState("");
  const [lyricsRequest, setLyricsRequest] = useState(0);
  const [seeds, setSeeds] = useState([]),
    [seedLoading, setSeedLoading] = useState(false);
  useEffect(() => {
    if (current || seeds.length || seedLoading) return;
    setSeedLoading(true);
    Promise.all([
      api("/api/local/files?limit=10").catch(() => ({ items: [] })),
      api("/api/library/tracks?pageSize=10").catch(() => ({ items: [] })),
    ])
      .then(([local, plexTracks]) => {
        const localItems = (local.items || []).map((item) => ({
          ...item,
          source: "local_file",
        }));
        const plexItems = (plexTracks.items || []).map((item) => ({
          ...item,
          source: "plex_item",
        }));
        setSeeds([...localItems, ...plexItems].slice(0, 12));
      })
      .finally(() => setSeedLoading(false));
  }, [current, seeds.length, seedLoading]);
  useEffect(() => {
    setResolvedLyrics("");
    setLyricsError("");
    if (!current || String(current.lyrics || "").trim()) {
      setLyricsLoading(false);
      return;
    }
    const key =
      current.sourceType === "plex_item"
        ? current.plexRatingKey || current.raw?.ratingKey
        : current.sourceType === "local_file"
          ? current.localFileId || current.raw?.id
          : "";
    if (!key) {
      setLyricsLoading(false);
      return;
    }
    let cancelled = false;
    setLyricsLoading(true);
    api(
      current.sourceType === "plex_item"
        ? `/api/player/plex/${encodeURIComponent(key)}/lyrics`
        : `/api/player/local/${encodeURIComponent(key)}/lyrics`,
    )
      .then((data) => {
        if (!cancelled) setResolvedLyrics(String(data.lyrics || "").trim());
      })
      .catch((error) => {
        if (!cancelled)
          setLyricsError(error.message || "暂时无法获取歌词");
      })
      .finally(() => {
        if (!cancelled) setLyricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.lyrics, lyricsRequest]);
  const lyricsText = String(current?.lyrics || "").trim() || resolvedLyrics;
  const lyricsTrack = current ? { ...current, lyrics: lyricsText } : current;
  const parsedLyrics = parseLrc(lyricsText);
  const displayLyrics = displayLyricsFor(lyricsTrack, parsedLyrics);
  const activeLine = displayLyrics.reduce(
    (acc, line, index) => (line.time <= player.currentTime ? index : acc),
    0,
  );
  const albumCover = coverUrlFor(current);
  const bg = albumCover || "";
  const cover = albumCover || VISUAL_FALLBACKS.cover;
  const accent =
    current?.accentColor ||
    current?.dominantColor ||
    current?.raw?.accentColor ||
    current?.raw?.dominantColor ||
    "#e3b459";
  const meta = [
    ["专辑", current?.album || "未知专辑", Album],
    ["来源", sourceLabel(current?.sourceType), Server],
    current?.raw?.year || current?.year
      ? ["年份", current.raw?.year || current.year, Clock3]
      : null,
    current?.raw?.genre || current?.genre
      ? ["风格", current.raw?.genre || current.genre, Tags]
      : null,
  ].filter(Boolean);
  const queue = player.queue || [];
  const queueTotal = [current, ...queue]
    .filter(Boolean)
    .reduce((sum, item) => sum + Number(item.duration || 0), 0);
  const showLyrics = playerSettings.showLyrics !== false;
  const liked = player.isFavorite(current);
  const airplayCast = useAirPlayLyricsCast({
    track: lyricsTrack,
    lyrics: lyricsText,
    player,
  });
  const addCurrentToPlaylist = () => {
    const names = Object.keys(player.playlists || {});
    const name = names.length
      ? prompt(`添加到歌单（已有：${names.join("、")}）`, names[0])
      : prompt("新建歌单名称");
    if (!name) return;
    if (!player.playlists?.[name]) player.createPlaylist(name);
    player.addToPlaylist(name, current);
  };
  if (!current)
    return (
      <div className="page player-page standalone-player-page">
        <button
          className="player-corner-button player-back-button"
          onClick={() => navigate?.("home")}
          aria-label="返回音屿"
        >
          <ArrowLeft />
        </button>
        <section className="player-stage player-pro player-empty-state smart-player-empty">
          <div className="player-bg" />
          <div className="player-bg-gradient" />
          <div className="player-empty-copy">
            {player.loading || seedLoading ? (
              <LoaderCircle className="spin" />
            ) : (
              <Play />
            )}
            <span className="eyebrow">
              <Radio />
              SMART QUEUE
            </span>
            <h1>{player.loading ? "正在准备播放…" : "还没有播放内容"}</h1>
            <p>
              {player.error ||
                "从音乐库、发现页或最近播放里选一首；也可以让音屿从真实曲库里随机开播。"}
            </p>
            <div className="player-empty-actions">
              <button
                className="primary"
                disabled={!seeds.length}
                onClick={() =>
                  player.play(
                    seeds[Math.floor(Math.random() * seeds.length)],
                    sanitizeQueue(seeds),
                  )
                }
              >
                <Shuffle />
                随机播放
              </button>
              <button
                className="secondary"
                onClick={() => navigate?.("library")}
              >
                <Library />
                打开音乐库
              </button>
              <button
                className="secondary"
                onClick={() => navigate?.("discover")}
              >
                <Sparkles />
                今日推荐
              </button>
            </div>
            {player.error && (
              <button className="secondary" onClick={player.clear}>
                <X />
                清除错误
              </button>
            )}
          </div>
          <div className="player-seed-grid">
            {seeds.length ? (
              seeds.slice(0, 8).map((item) => (
                <button
                  key={`${item.source}-${item.id || item.ratingKey}`}
                  onClick={() => player.play(item, sanitizeQueue(seeds, item))}
                >
                  <div className="seed-cover">
                    {coverUrlFor(item) ? (
                      <img src={coverUrlFor(item)} alt="" />
                    ) : (
                      <Disc3 />
                    )}
                  </div>
                  <strong>
                    {normalizeTrackTitle(item.title || item.filename)}
                  </strong>
                  <span>
                    {item.artist || item.grandparentTitle || "未知歌手"}
                  </span>
                  <Play />
                </button>
              ))
            ) : (
              <Empty
                icon={Music2}
                title="还没读到可播曲目"
                text="扫描本地曲库或同步 Plex 后，这里会出现真实推荐。"
              />
            )}
          </div>
        </section>
      </div>
    );
  return (
    <div
      className="page player-page standalone-player-page"
      style={{ "--player-accent": accent }}
    >
      <button
        className="player-corner-button player-back-button"
        onClick={() => navigate?.("home")}
        aria-label="返回音屿"
      >
        <ArrowLeft />
      </button>
      <button
        className="player-corner-button player-fullscreen-corner"
        onClick={() => document.documentElement.requestFullscreen?.()}
        aria-label="全屏播放"
      >
        <Maximize2 />
      </button>
      <section className="player-stage player-pro player-immersive">
        <div
          className="player-bg"
          style={{ backgroundImage: `url(${bg || VISUAL_FALLBACKS.player})` }}
        />
        <div className="player-bg-gradient" />
        <div className="player-layout player-immersive-grid">
          <article className="player-primary-card player-control-deck">
            <div className="player-art-wrap">
              <div className="player-cover">
                {cover ? (
                  <img src={cover} alt={current.title || "专辑封面"} />
                ) : (
                  <Music2 />
                )}
              </div>
              <div className="player-badges player-compact-badges">
                <span>
                  {player.quality === "original"
                    ? "无损原始"
                    : player.quality.toUpperCase()}
                </span>
                <span>{sourceLabel(current.sourceType)}</span>
              </div>
            </div>
            <div className="player-main">
              <h1>{current.title || "未命名歌曲"}</h1>
              <p className="player-artist-line">
                {current.artist || "未知歌手"}
                <ChevronRight />
                {current.album || "未知专辑"}
              </p>
              {player.error && (
                <div className="inline-error">
                  <CircleAlert />
                  {player.error}
                </div>
              )}
              <div className="player-progress">
                <span>{formatTime(player.currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={player.duration || 0}
                  value={Math.min(player.currentTime, player.duration || 0)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
                <span>{formatTime(player.duration)}</span>
              </div>
              <div className="player-main-controls">
                <button
                  aria-label="随机播放"
                  onClick={() => player.setQueue([...queue].reverse())}
                >
                  <Shuffle />
                </button>
                <button aria-label="上一首" onClick={player.previous}>
                  <ChevronRight className="prev-icon" />
                </button>
                <button
                  className="play-large"
                  aria-label={player.isPlaying ? "暂停" : "播放"}
                  onClick={player.toggle}
                >
                  {player.isPlaying ? <Pause /> : <Play />}
                </button>
                <button aria-label="下一首" onClick={player.next}>
                  <ChevronRight />
                </button>
                <button
                  className={player.playMode === "repeat_one" ? "active" : ""}
                  aria-label={
                    player.playMode === "repeat_one"
                      ? "单曲循环已开启"
                      : "开启单曲循环"
                  }
                  onClick={() =>
                    player.setPlayMode(
                      player.playMode === "repeat_one" ? "order" : "repeat_one",
                    )
                  }
                >
                  <Repeat />
                </button>
              </div>
              <div className="player-controls-extra">
                <label className="quality-select">
                  <span>音质</span>
                  <select
                    value={player.quality}
                    onChange={(e) => player.setQuality(e.target.value)}
                  >
                    <option value="original">Original</option>
                    <option value="320k">320K</option>
                    <option value="256k">256K</option>
                    <option value="192k">192K</option>
                    <option value="128k">128K</option>
                  </select>
                </label>
                <label className="quality-select">
                  <span>速度</span>
                  <select
                    onChange={(e) => {
                      if (player.audioRef.current)
                        player.audioRef.current.playbackRate = Number(
                          e.target.value,
                        );
                    }}
                    defaultValue="1"
                  >
                    <option value="0.75">0.75x</option>
                    <option value="1">1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                  </select>
                </label>
                <label className="quality-select">
                  <Volume2 />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={player.volume}
                    onChange={(e) => player.setVolume(e.target.value)}
                  />
                </label>
                <button
                  className={`secondary small ${liked ? "active" : ""}`}
                  onClick={() => player.toggleFavorite(current)}
                >
                  <Heart />
                  {liked ? "已喜欢" : "喜欢"}
                </button>
                <button
                  className="secondary small"
                  onClick={addCurrentToPlaylist}
                >
                  <ListMusic />
                  加入歌单
                </button>
                <AirPlayCastButton cast={airplayCast} />
              </div>
              {airplayCast.message && (
                <div className={`airplay-cast-status ${airplayCast.wireless ? "active" : ""}`} role="status">
                  <Airplay />
                  <span>{airplayCast.message}</span>
                </div>
              )}
            </div>
          </article>
          <aside
            className={`queue-panel player-queue-drawer ${queueOpen ? "open" : ""}`}
            aria-hidden={!queueOpen}
          >
            <SectionHead
              title={`播放队列（${queue.length + 1}）`}
              note={`总时长 ${queueTotal ? formatTime(queueTotal) : formatTime(player.duration)}`}
              action={<div className="queue-drawer-actions">
                {queue.length ? (
                  <button className="text-button" onClick={() => player.setQueue([])}>清空</button>
                ) : <span className="queue-hint">没有待播歌曲</span>}
                <button className="icon-button" onClick={() => setQueueOpen(false)} aria-label="关闭播放队列"><X /></button>
              </div>}
            />
            <div className="queue-item active" aria-current="true">
              <div className="queue-thumb">
                {cover ? <img src={cover} alt="" /> : <Music2 />}
              </div>
              <div>
                <strong>{current.title}</strong>
                <span>{current.artist || "未知歌手"} · 正在播放</span>
              </div>
              <span className="playing-indicator">
                <i />
                <i />
                <i />
              </span>
              <em>{formatTime(player.duration)}</em>
            </div>
            {queue.length ? (
              queue.map((item, index) => (
                <button
                  className="queue-item"
                  key={item.id || `${item.title}-${index}`}
                  onClick={() =>
                    player.play(
                      item,
                      queue.slice(index + 1),
                    )
                  }
                >
                  <span className="queue-index">
                    {String(index + 2).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist || "未知歌手"} · {item.album || "待播放"}
                    </span>
                  </div>
                  <em>{item.duration ? formatTime(item.duration) : "—"}</em>
                  <X
                    onClick={(event) => {
                      event.stopPropagation();
                      player.removeFromQueue(item.id);
                    }}
                  />
                </button>
              ))
            ) : (
              <div className="queue-empty">
                <ListMusic />
                <strong>队列为空</strong>
                <span>在音乐库、发现页或搜索结果里点“下一首/加入队列”。</span>
              </div>
            )}
          </aside>
          {showLyrics ? (
            <section className="lyrics-panel player-lyrics-card">
              <div className="lyrics-head">
                <Mic2 />
                <span>歌词</span>
                <div>
                  {displayLyrics.length ? (
                    <button
                      className="lyrics-fullscreen-button"
                      onClick={() => setLyricsFull(true)}
                    >
                      <Maximize2 />
                      全屏歌词
                    </button>
                  ) : lyricsLoading ? (
                    <span className="lyrics-fetching">
                      <LoaderCircle className="spin" />
                      正在匹配
                    </span>
                  ) : (
                    <button
                      className="lyrics-fullscreen-button"
                      onClick={() => setLyricsRequest((value) => value + 1)}
                    >
                      <RefreshCw />
                      重新获取
                    </button>
                  )}
                </div>
              </div>
              {displayLyrics.length ? (
                displayLyrics.map((line, index) => (
                  <p
                    className={index === activeLine ? "active" : ""}
                    key={`${line.time}-${index}`}
                  >
                    {line.text}
                  </p>
                ))
              ) : (
                <Empty
                  icon={Mic2}
                  title={
                    lyricsLoading
                      ? "正在匹配歌词"
                      : lyricsError
                        ? "歌词获取失败"
                        : "这首歌还没有可用歌词"
                  }
                  text={
                    lyricsLoading
                      ? "正在按歌曲、艺人和时长核验可用歌词。"
                      : lyricsError ||
                        (isAdmin
                          ? "没有找到通过校验的版本，可在资料补全中继续处理。"
                          : "暂时没有找到通过校验的歌词。")
                  }
                />
              )}
            </section>
          ) : (
            <section className="lyrics-panel player-lyrics-card">
              <Empty
                icon={Mic2}
                title="歌词显示已关闭"
                text="可在系统设置 > 播放器中重新打开。"
              />
            </section>
          )}
        </div>
      </section>
      <button
        className="player-queue-fab"
        onClick={() => setQueueOpen(true)}
        aria-label={`打开播放队列，共 ${queue.length + 1} 首`}
      >
        <ListMusic />
        <span>{queue.length + 1}</span>
      </button>
      <video
        ref={airplayCast.videoRef}
        className="airplay-cast-video"
        src={airplayCast.streamUrl || undefined}
        x-webkit-airplay="allow"
        playsInline
        muted
        preload="none"
        aria-hidden="true"
      />
      {lyricsFull && showLyrics && (
        <LyricsFullscreenOverlay
          current={lyricsTrack}
          cover={cover}
          bg={bg}
          lines={displayLyrics}
          activeLine={activeLine}
          player={player}
          airplayCast={airplayCast}
          onClose={() => setLyricsFull(false)}
        />
      )}
    </div>
  );
}

function LyricsFullscreenOverlay({
  current,
  cover,
  bg,
  lines,
  activeLine,
  player,
  airplayCast,
  onClose,
}) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <section
      className="lyrics-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="全屏歌词"
    >
      <div className="lyrics-overlay-backdrop" aria-hidden="true">
        <img src={bg || cover || VISUAL_FALLBACKS.player} alt="" />
        <i />
      </div>
      <button className="lyrics-overlay-close" onClick={onClose}>
        <X />
        关闭
      </button>
      <div className="lyrics-overlay-airplay">
        <AirPlayCastButton cast={airplayCast} overlay />
        {airplayCast.message && <small>{airplayCast.message}</small>}
      </div>
      <div className="lyrics-overlay-song">
        <div className="lyrics-overlay-cover">
          {cover ? <img src={cover} alt="" /> : <Music2 />}
        </div>
        <div>
          <strong>{current?.title || "未命名歌曲"}</strong>
          <span>
            {current?.artist || "未知歌手"} · {current?.album || "未知专辑"}
          </span>
        </div>
      </div>
      <div className="lyrics-overlay-lines">
        {lines.map((line, index) => (
          <p
            className={
              index === activeLine
                ? "active"
                : Math.abs(index - activeLine) <= 1
                  ? "near"
                  : "far"
            }
            key={`${line.time}-${index}`}
            onClick={() => Number.isFinite(line.time) && player.seek(line.time)}
          >
            {line.text}
          </p>
        ))}
      </div>
      <div className="lyrics-overlay-controls">
        <span>{formatTime(player.currentTime)}</span>
        <input
          type="range"
          min="0"
          max={player.duration || 0}
          value={Math.min(player.currentTime, player.duration || 0)}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <span>{formatTime(player.duration)}</span>
        <button onClick={player.previous}>
          <ChevronRight className="prev-icon" />
        </button>
        <button className="play-large" onClick={player.toggle}>
          {player.isPlaying ? <Pause /> : <Play />}
        </button>
        <button onClick={player.next}>
          <ChevronRight />
        </button>
      </div>
    </section>
  );
}

const formatTime = (value) => {
  const v = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

function MiniPlayer({ openPlayer, navigate }) {
  const player = usePlayer(),
    current = player.currentTrack;
  if (!current) return null;
  const cover = coverUrlFor(current) || VISUAL_FALLBACKS.cover;
  const liked = player.isFavorite(current);
  return (
    <div className="mini-player">
      <button className="mini-cover" onClick={openPlayer}>
        <img src={cover} alt="" />
      </button>
      <div className="mini-copy">
        <strong>{current.title}</strong>
        <span>
          {current.artist || "未知歌手"} · {sourceLabel(current.sourceType)}
        </span>
      </div>
      <button
        className={`mini-like ${liked ? "active" : ""}`}
        aria-label={liked ? "取消喜欢" : "喜欢"}
        onClick={() => player.toggleFavorite(current)}
      >
        <Heart />
      </button>
      <div className="mini-controls">
        <button onClick={player.previous}>
          <ChevronRight className="prev-icon" />
        </button>
        <button onClick={player.toggle}>
          {player.isPlaying ? <Pause /> : <Play />}
        </button>
        <button onClick={player.next}>
          <ChevronRight />
        </button>
        <div className="mini-progress">
          <i
            style={{
              width: `${player.duration ? pct(player.currentTime, player.duration) : 0}%`,
            }}
          />
        </div>
        <span>
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </span>
      </div>
      <label className="mini-volume">
        <select
          value={player.quality}
          onChange={(e) => player.setQuality(e.target.value)}
        >
          <option value="original">Original</option>
          <option value="320k">320K</option>
          <option value="256k">256K</option>
          <option value="192k">192K</option>
          <option value="128k">128K</option>
        </select>
        <Volume2 />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={player.volume}
          onChange={(e) => player.setVolume(e.target.value)}
        />
      </label>
      <button className="icon-button" onClick={openPlayer}>
        <ListMusic />
      </button>
      <button className="icon-button" onClick={player.clear}>
        <X />
      </button>
    </div>
  );
}

const scrapeTabs = [
  {
    id: "plex",
    kind: "scrape_plex_metadata",
    icon: UsersRound,
    tone: "amber",
    title: "Plex 元数据补全",
    desc: "补齐歌手海报、背景、中文简介与专辑封面，并触发 Plex 扫描。",
    chips: ["歌手海报", "歌手背景", "中文简介", "专辑封面"],
  },
  {
    id: "tags",
    kind: "fill_local_tags",
    icon: Tags,
    tone: "blue",
    title: "本地标签补全",
    desc: "扫描标题、歌手、专辑、年份、音轨号与流派，为后续整理提供依据。",
    chips: ["标题", "歌手", "专辑", "年份", "音轨号", "流派"],
  },
  {
    id: "assets",
    kind: "fill_assets",
    icon: BookOpenText,
    tone: "violet",
    title: "封面与歌词",
    desc: "补齐 cover.jpg、内嵌封面、同名 .lrc 与 UTF-8 歌词文件。",
    chips: ["cover.jpg", "内嵌封面", "同名 LRC", "UTF-8"],
  },
  {
    id: "rename",
    kind: "local_organize",
    icon: FolderTree,
    tone: "green",
    title: "重命名与目录整理",
    desc: "按 Plex 规则生成目标路径，先预览冲突，再批量移动目录。",
    chips: ["路径预览", "冲突检测", "Unknown 修复", "回滚"],
  },
  {
    id: "tasks",
    kind: "tasks",
    icon: ScrollText,
    tone: "pink",
    title: "任务记录",
    desc: "查看刮削、扫描、整理的进度、计数、错误和日志。",
    chips: ["进度", "成功/失败/跳过", "错误日志", "取消/重试"],
  },
];

function ScrapeCenter({ jobs, navigate, settings }) {
  const activeKinds = new Set(
    jobs
      .filter((j) => ["queued", "running"].includes(j.status))
      .map((j) => j.kind),
  );
  const [tab, setTab] = useState("plex"),
    [mode, setMode] = useState(settings?.scrapeRules?.defaultMode || "missing"),
    [scope, setScope] = useState("missing"),
    [scopeValue, setScopeValue] = useState("");
  const [plan, setPlan] = useState(null),
    [planPage, setPlanPage] = useState(1),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const action = scrapeTabs.find((item) => item.id === tab) || scrapeTabs[0];
  const generatePlan = async () => {
    setBusy("preview");
    setError("");
    try {
      setPlan(
        await api("/api/scrape/preview", {
          method: "POST",
          body: JSON.stringify({ kind: action.kind, scope, scopeValue, mode, limit: 150 }),
        }),
      );
      setPlanPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  const planPageSize = 50;
  const planItems = plan?.items || [];
  const planPages = Math.max(1, Math.ceil(planItems.length / planPageSize));
  const visiblePlanItems = planItems.slice(
    (planPage - 1) * planPageSize,
    planPage * planPageSize,
  );
  const applyPlan = async () => {
    if (!plan) {
      generatePlan();
      return;
    }
    if (
      !confirm(
        `确认应用“${action.title}”？\n\n范围：${scope}\n模式：${mode}\n执行后会进入任务中心，可在日志/回滚记录中追踪。`,
      )
    )
      return;
    setBusy("apply");
    setError("");
    try {
      await api("/api/scrape/apply", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });
      navigate?.("tasks");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="page scrape-page">
      <section className="page-intro">
        <span className="eyebrow">
          <Zap size={14} />
          SCRAPE CENTER
        </span>
        <h1>补齐封面、歌词、背景与中文简介。</h1>
        <p>先核对旧值、候选结果、来源与冲突，再决定是否应用。</p>
      </section>
      <div className="scrape-tabs">
        {scrapeTabs.map((item) => (
          <button
            className={tab === item.id ? "active" : ""}
            onClick={() => {
              if (item.id === "tasks") {
                navigate?.("tasks");
                return;
              }
              setTab(item.id);
              setPlan(null);
              setPlanPage(1);
            }}
            key={item.id}
          >
            <item.icon />
            {item.title}
          </button>
        ))}
      </div>
      <section className="panel scrape-workbench">
        <div className="scrape-main">
          <div className={`action-icon ${action.tone}`}>
            <action.icon />
          </div>
          <div>
            <h3>{action.title}</h3>
            <p>{action.desc}</p>
            <div className="chips">
              {action.chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="scrape-options">
          <label>
            范围
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPlan(null);
                setPlanPage(1);
              }}
            >
              <option value="all">全部</option>
              <option value="missing">缺失项</option>
              <option value="specific_artist">指定歌手</option>
              <option value="specific_album">指定专辑</option>
              <option value="folder">指定文件夹</option>
              <option value="missing_cover">仅缺失封面</option>
              <option value="missing_lyrics">仅缺失歌词</option>
              <option value="missing_background">仅缺失背景图</option>
              <option value="missing_bio">仅缺失中文简介</option>
              <option value="unknown">Unknown Artist / Album</option>
            </select>
          </label>
          {["specific_artist", "specific_album", "folder"].includes(scope) && (
            <label>
              {scope === "folder" ? "目录" : "名称"}
              <input
                value={scopeValue}
                onChange={(e) => {
                  setScopeValue(e.target.value);
                  setPlan(null);
                }}
                placeholder={scope === "folder" ? "/music/歌手/专辑" : "输入准确名称"}
              />
            </label>
          )}
          <label>
            模式
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setPlan(null);
                setPlanPage(1);
              }}
            >
              <option value="missing">只补缺失</option>
              <option value="incremental">增量更新</option>
              <option value="refresh">全量刷新</option>
              <option value="force">强制覆盖</option>
            </select>
          </label>
        </div>
        {error && (
          <div className="inline-error">
            <CircleAlert />
            {error}
          </div>
        )}
        <div className="preview-list scrape-preview">
          {plan ? (
            <>
              <div>
                <div>
                  <small>预览生成时间</small>
                  <code>
                    {new Date(plan.createdAt).toLocaleString("zh-CN")}
                  </code>
                </div>
                <ChevronRight />
                <div>
                  <small>策略</small>
                  <code>
                    {plan.scope} · {plan.mode}
                  </code>
                </div>
                <i className="safe">未执行</i>
              </div>
              <div className="scrape-summary">
                <span>新增 {plan.summary.create}</span>
                <span>替换 {plan.summary.replace}</span>
                <span>跳过 {plan.summary.skip}</span>
                <span>冲突 {plan.summary.conflicts}</span>
              </div>
              <div className="scrape-diff-head">
                <span>对象 / 字段</span>
                <span>旧值</span>
                <span>候选新值</span>
                <span>来源 / 置信度</span>
                <span>结果</span>
              </div>
              {visiblePlanItems.map((item) => (
                <div className="scrape-diff-row" key={item.id}>
                  <div>
                    <strong>{item.target}</strong>
                    <small>{item.field}</small>
                  </div>
                  <code>{item.oldValue}</code>
                  <code>{item.newValue}</code>
                  <div>
                    <strong>{item.candidateSource}</strong>
                    <small>{Math.round(item.confidence * 100)}% 置信度</small>
                  </div>
                  <i
                    className={
                      item.conflict || item.action === "skip"
                        ? "danger"
                        : "safe"
                    }
                  >
                    {item.skipReason ||
                      (item.conflict
                        ? "存在冲突"
                        : item.action === "replace"
                          ? "将替换"
                          : "将新增")}
                  </i>
                </div>
              ))}
              {planItems.length > planPageSize && (
                <div className="pagination scrape-pagination">
                  <button
                    className="secondary small"
                    disabled={planPage <= 1}
                    onClick={() => setPlanPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    第 {planPage} / {planPages} 页 · 共 {planItems.length} 项
                  </span>
                  <button
                    className="secondary small"
                    disabled={planPage >= planPages}
                    onClick={() => setPlanPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          ) : (
            <div>
              <div>
                <small>预览状态</small>
                <code>尚未生成</code>
              </div>
              <ChevronRight />
              <div>
                <small>下一步</small>
                <code>先点击生成差异预览</code>
              </div>
              <i>不会执行</i>
            </div>
          )}
        </div>
        <div className="scrape-actions">
          <button
            className="secondary"
            disabled={activeKinds.has(action.kind) || !!busy}
            onClick={generatePlan}
          >
            {busy === "preview" ? <LoaderCircle className="spin" /> : <Gauge />}
            生成差异预览
          </button>
          <button
            className="primary"
            disabled={
              activeKinds.has(action.kind) ||
              !plan ||
              !!busy ||
              plan.summary.create + plan.summary.replace === 0
            }
            onClick={applyPlan}
          >
            {activeKinds.has(action.kind) || busy === "apply" ? (
              <LoaderCircle className="spin" />
            ) : (
              <Check />
            )}
            应用修改
          </button>
        </div>
      </section>
      <section className="safe-note">
        <ShieldCheck />
        <div>
          <strong>安全写入策略</strong>
          <p>无法精确匹配的条目会自动跳过；完成后可在任务中心查看结果。</p>
        </div>
      </section>
    </div>
  );
}

const SOURCE_STATES = {
  unverified: ["未验证", "muted"],
  imported: ["已导入", "amber"],
  search_ok: ["搜索可用", "blue"],
  inspect_ok: ["接口已授权", "green"],
  partial: ["接口已授权", "green"],
  degraded: ["已授权 · 运行异常", "amber"],
  resolve_ok: ["解析可用", "green"],
  unavailable: ["不可用", "red"],
  disabled: ["已禁用", "muted"],
};

function SourceManager({ sources, refreshSources, notify }) {
  const [mode, setMode] = useState("url"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [code, setCode] = useState(""),
    [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [keyword, setKeyword] = useState(""),
    [quality, setQuality] = useState("320k");
  const [testing, setTesting] = useState(""),
    [testData, setTestData] = useState(null),
    [logs, setLogs] = useState(null),
    [inspection, setInspection] = useState(null);
  const importSource = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result;
      if (mode === "file") {
        if (!file) throw new Error("请选择本地 .js 音乐源文件。");
        const body = new FormData();
        body.append("name", name);
        body.append("file", file);
        result = await api("/api/sources/import-file", {
          method: "POST",
          body,
        });
      } else if (mode === "code")
        result = await api("/api/sources/import-code", {
          method: "POST",
          body: JSON.stringify({ name, code }),
        });
      else
        result = await api("/api/sources/import-url", {
          method: "POST",
          body: JSON.stringify({ name, url }),
        });
      await refreshSources();
      setName("");
      setUrl("");
      setCode("");
      setFile(null);
      if (!result.ok) setError(`导入完成但校验失败：${result.message}`);
      else notify(result.message);
    } catch (err) {
      setError(`导入失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const testSearch = async (source) => {
    const probe = keyword.trim();
    if (!probe) {
      setError(
        "请输入一首你真实想测试的歌曲或歌手，系统不会再使用演示关键词。",
      );
      return;
    }
    setTesting(source.id);
    setError("");
    try {
      const platform = source.supportedPlatforms?.includes("tx")
        ? "tx"
        : source.supportedPlatforms?.[0];
      const result = await api(`/api/sources/${source.id}/test-search`, {
        method: "POST",
        body: JSON.stringify({ keyword: probe, platform }),
      });
      setTestData({ source, result });
      await refreshSources();
      notify(`“${source.displayName}”测试搜索成功`);
    } catch (err) {
      setError(`测试搜索失败：${err.message}`);
      await refreshSources();
    } finally {
      setTesting("");
    }
  };
  const inspect = async (source) => {
    setTesting(`inspect-${source.id}`);
    setError("");
    try {
      const result = await api(`/api/sources/${source.id}/inspect`, {
        method: "POST",
      });
      setInspection({ source, result });
      await refreshSources();
    } catch (err) {
      setError(`格式检查失败：${err.message}`);
    } finally {
      setTesting("");
    }
  };
  const testResolve = async (track) => {
    setTesting(`resolve-${track.trackId}`);
    setError("");
    try {
      const result = await api(
        `/api/sources/${testData.source.id}/test-resolve`,
        { method: "POST", body: JSON.stringify({ track, quality }) },
      );
      notify(result.message);
      await refreshSources();
    } catch (err) {
      setError(`解析失败：${err.message}`);
      await refreshSources();
    } finally {
      setTesting("");
    }
  };
  const toggle = async (source) => {
    try {
      await api(
        `/api/sources/${source.id}/${source.enabled ? "disable" : "enable"}`,
        { method: "POST" },
      );
      await refreshSources();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async (source) => {
    if (!confirm(`确定删除“${source.displayName}”？这不会删除音乐库文件。`))
      return;
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      if (logs?.source.id === source.id) setLogs(null);
      await refreshSources();
    } catch (err) {
      setError(err.message);
    }
  };
  const showLogs = async (source) => {
    try {
      setLogs({ source, items: await api(`/api/sources/${source.id}/logs`) });
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="page sources-page">
      <section className="source-layout">
        <form className="panel source-import" onSubmit={importSource}>
          <SectionHead
            title="导入音乐源"
            note="识别到音乐接口后会立即启用"
          />
          <div className="import-tabs">
            {[
              ["url", Link2, "在线 URL"],
              ["file", FileUp, "本地文件"],
              ["code", Code2, "粘贴源码"],
            ].map(([id, Icon, label]) => (
              <button
                type="button"
                className={mode === id ? "active" : ""}
                onClick={() => {
                  setMode(id);
                  setError("");
                }}
                key={id}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <label>
            显示名称（可选）
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的无损源"
            />
          </label>
          {mode === "url" && (
            <label>
              Raw JavaScript URL
              <input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/latest.js"
              />
            </label>
          )}
          {mode === "file" && (
            <label className="file-picker">
              <input
                type="file"
                accept=".js,application/javascript,text/javascript"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <FileUp />
              <strong>{file?.name || "选择本地 .js 文件"}</strong>
              <span>最大 2 MB · 浏览器上传，不填写电脑路径</span>
            </label>
          )}
          {mode === "code" && (
            <label>
              JavaScript 源码
              <textarea
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="粘贴完整 LX 自定义音乐源源码…"
              />
            </label>
          )}
          <p className="modal-note">
            <ShieldCheck />
            不内置第三方音乐源。仅导入你信任且有权使用的脚本；音屿不绕过 DRM。
          </p>
          <button className="primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : <Plus />}导入并启用
          </button>
        </form>
        <section className="panel source-guide">
          <span className="eyebrow">
            <TestTube2 />
            SOURCE CHECK
          </span>
          <h3>识别通过，立即可用。</h3>
          <p>
            导入时完成结构与安全校验，通过后默认启用；搜索和音频解析测试用于确认具体能力，不会阻止你启用音乐源。
          </p>
          <ol>
            <li>
              <b>01</b> 导入并检查脚本结构
            </li>
            <li>
              <b>02</b> 校验通过后自动启用
            </li>
            <li>
              <b>03</b> 搜索与下载权限立即开放
            </li>
            <li>
              <b>04</b> 实际使用时记录接口状态
            </li>
          </ol>
        </section>
      </section>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <section className="panel installed-sources">
        <SectionHead
          title="已安装音乐源"
          note={`${sources.length} 个来源 · 格式、搜索、解析与启用状态分别记录`}
        />
        {sources.length ? (
          <div className="source-cards">
            {sources.map((source) => {
              const [label, tone] = SOURCE_STATES[source.status] || [
                source.status,
                "muted",
              ];
              return (
                <article className="source-card" key={source.id}>
                  <div className="source-card-head">
                    <div className="source-logo">
                      <Music2 />
                    </div>
                    <div>
                      <strong>{source.displayName}</strong>
                      <span>
                        {source.metadata?.author || "自定义来源"} ·{" "}
                        {source.sourceType}
                      </span>
                    </div>
                    <i className={`source-state ${tone}`}>{label}</i>
                  </div>
                  <dl>
                    <div>
                      <dt>检测格式</dt>
                      <dd>
                        {source.detectedFormat || "待检查"} ·{" "}
                        {source.compatibility || "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>使用权限</dt>
                      <dd>
                        {source.accessGranted
                          ? "搜索与下载已开放"
                          : source.enabled
                            ? "等待接口识别"
                            : "已停用"}
                      </dd>
                    </div>
                    <div>
                      <dt>运行验证</dt>
                      <dd>
                        搜索 {source.searchOk ? "成功" : "待运行"} · 解析{" "}
                        {source.resolveOk ? "成功" : "待运行"}
                      </dd>
                    </div>
                    <div>
                      <dt>支持平台</dt>
                      <dd>
                        {source.supportedPlatforms?.join(" · ") || "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>支持音质</dt>
                      <dd>
                        {source.supportedQualities?.join(" · ") || "待测试"}
                      </dd>
                    </div>
                    <div>
                      <dt>最近测试</dt>
                      <dd>
                        {source.lastTestAt
                          ? timeAgo(source.lastTestAt)
                          : "尚未测试"}
                      </dd>
                    </div>
                  </dl>
                  {source.lastErrorMessage && (
                    <p className="source-error">
                      <CircleAlert />
                      {source.lastErrorMessage}
                    </p>
                  )}
                  <div className="source-actions">
                    <button
                      className="secondary small"
                      disabled={testing === `inspect-${source.id}`}
                      onClick={() => inspect(source)}
                    >
                      {testing === `inspect-${source.id}` ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Gauge />
                      )}
                      检查格式
                    </button>
                    <button
                      className="secondary small"
                      disabled={testing === source.id}
                      onClick={() => testSearch(source)}
                    >
                      {testing === source.id ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Search />
                      )}
                      测试搜索
                    </button>
                    <button
                      className="icon-button"
                      title="查看日志"
                      onClick={() => showLogs(source)}
                    >
                      <ScrollText />
                    </button>
                    <button
                      className={`icon-button ${source.enabled ? "powered" : ""}`}
                      title={source.enabled ? "禁用" : "启用"}
                      onClick={() => toggle(source)}
                    >
                      <Power />
                    </button>
                    <button
                      className="icon-button danger"
                      title="删除"
                      onClick={() => remove(source)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={Wifi}
            title="还没有音乐源"
            text="可通过 URL、本地 .js 文件或粘贴源码导入。"
          />
        )}
      </section>
      {testData && (
        <section className="panel source-test">
          <SectionHead
            title={`测试搜索 · ${testData.source.displayName}`}
            note={`找到 ${testData.result.count} 首候选歌曲，可选择一首测试播放地址`}
            action={
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="128k">128K</option>
                <option value="320k">320K</option>
                <option value="flac">FLAC</option>
                <option value="flac24bit">Hi-Res</option>
              </select>
            }
          />
          <div className="result-list">
            {testData.result.results.map((item) => (
              <div
                className="result-row source-result"
                key={`${item.platform}-${item.trackId}`}
              >
                <div className="result-cover">
                  {item.coverUrl ? <img src={item.coverUrl} /> : <Music2 />}
                </div>
                <div className="result-main">
                  <strong>{item.title}</strong>
                  <span>
                    {item.artist} · {item.album || "单曲"}
                  </span>
                </div>
                <span className="duration">
                  {Math.floor(item.duration / 60)}:
                  {String(item.duration % 60).padStart(2, "0")}
                </span>
                <div className="quality-dots">
                  {item.qualities.slice(-2).map((q) => (
                    <i key={q}>{q}</i>
                  ))}
                </div>
                <button
                  className="secondary small"
                  disabled={testing === `resolve-${item.trackId}`}
                  onClick={() => testResolve(item)}
                >
                  {testing === `resolve-${item.trackId}` ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <TestTube2 />
                  )}
                  测试解析
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {logs && (
        <div className="modal-wrap">
          <button className="modal-backdrop" onClick={() => setLogs(null)} />
          <section className="modal panel log-modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">SOURCE LOG</span>
                <h3>{logs.source.displayName}</h3>
              </div>
              <button className="icon-button" onClick={() => setLogs(null)}>
                <X />
              </button>
            </div>
            <div className="log-list">
              {logs.items.length ? (
                logs.items.map((item) => (
                  <div className={item.level} key={item.id}>
                    <time>
                      {new Date(item.created_at).toLocaleString("zh-CN")}
                    </time>
                    <b>{item.action}</b>
                    <p>{item.message}</p>
                  </div>
                ))
              ) : (
                <Empty
                  icon={ScrollText}
                  title="暂无日志"
                  text="执行导入或测试后会记录在这里。"
                />
              )}
            </div>
          </section>
        </div>
      )}
      {inspection && (
        <div className="modal-wrap">
          <button
            className="modal-backdrop"
            onClick={() => setInspection(null)}
          />
          <section className="modal panel inspect-modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">SOURCE FORMAT</span>
                <h3>{inspection.source.displayName}</h3>
              </div>
              <button
                className="icon-button"
                onClick={() => setInspection(null)}
              >
                <X />
              </button>
            </div>
            <div className="inspect-summary">
              <i
                className={`source-state ${inspection.result.ok ? "green" : "red"}`}
              >
                {inspection.result.compatibility}
              </i>
              <strong>{inspection.result.detected_format}</strong>
              <p>{inspection.result.message}</p>
            </div>
            <dl>
              <div>
                <dt>顶层接口</dt>
                <dd>{inspection.result.top_level_keys?.join(" · ") || "无"}</dd>
              </div>
              <div>
                <dt>搜索</dt>
                <dd>
                  {inspection.result.methods?.search
                    ? "源内置"
                    : "音屿目录适配器"}
                </dd>
              </div>
              <div>
                <dt>地址解析</dt>
                <dd>{inspection.result.methods?.resolve ? "支持" : "缺失"}</dd>
              </div>
              <div>
                <dt>歌词 / 封面</dt>
                <dd>
                  {inspection.result.methods?.lyric ? "支持" : "—"} /{" "}
                  {inspection.result.methods?.cover ? "支持" : "—"}
                </dd>
              </div>
              <div>
                <dt>平台</dt>
                <dd>
                  {inspection.result.supported_platforms?.join(" · ") || "未知"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function DownloadInboxPanel({ notify, navigate }) {
  const [data, setData] = useState({ items: [], errors: [], summary: {} });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/local/download-inbox");
      setData(result);
      setSelected(
        (result.items || [])
          .filter((item) => !item.conflict && !item.needsReview)
          .map((item) => item.sourcePath),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const toggle = (path) =>
    setSelected((value) =>
      value.includes(path) ? value.filter((item) => item !== path) : [...value, path],
    );
  const ingest = async () => {
    const items = data.items.filter((item) => selected.includes(item.sourcePath));
    if (!items.length) return;
    if (!confirm(`确认整理并入库 ${items.length} 首歌曲？\n\n文件会从独立下载目录移动到正式音乐库，原路径会写入回滚记录。`)) return;
    setBusy(true);
    try {
      await api("/api/local/download-inbox/ingest", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      notify?.(`${items.length} 首歌曲已进入整理队列`);
      navigate?.("tasks");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel download-inbox-panel">
      <SectionHead
        title="下载目录"
        note="先预览规范命名与目标层级，再移动到正式音乐库"
        action={
          <div className="pending-actions">
            <button className="secondary small" onClick={load} disabled={busy}><RefreshCw className={busy ? "spin" : ""} />重新扫描</button>
            <button className="primary small" onClick={ingest} disabled={busy || !selected.length}><FolderTree />整理入库 ({selected.length})</button>
          </div>
        }
      />
      <div className="inbox-roots">
        <span><Download />下载目录 <code>{data.downloadRoot || "/downloads"}</code></span>
        <ChevronRight />
        <span><Library />音乐库 <code>{data.musicRoot || "/music"}</code></span>
      </div>
      {error && <div className="inline-error"><CircleAlert />{error}</div>}
      {data.items?.length ? (
        <div className="inbox-table">
          {data.items.map((item) => (
            <label className={item.conflict ? "conflict" : item.needsReview ? "review" : ""} key={item.sourcePath}>
              <input type="checkbox" checked={selected.includes(item.sourcePath)} disabled={item.conflict} onChange={() => toggle(item.sourcePath)} />
              <div>
                <strong>{item.title}</strong>
                <small>{item.artist} · {item.album}</small>
              </div>
              <div className="inbox-paths">
                <code>{item.sourcePath}</code>
                <ChevronRight />
                <code>{item.targetPath}</code>
              </div>
              <em>{item.conflict ? "目标冲突" : item.needsReview ? "请核对信息" : "可入库"}</em>
            </label>
          ))}
        </div>
      ) : busy ? <PageLoader /> : (
        <Empty icon={Download} title="下载目录是空的" text="放入这里的音频会先经过标签、命名和路径预览。" />
      )}
    </section>
  );
}

function DownloadCenter({
  sources,
  refreshSources,
  createDownload,
  navigate,
  playPreview,
  notify,
}) {
  const ready = sources.filter(sourceCatalogReady);
  const [query, setQuery] = useState(
      () => localStorage.getItem("songlib-download-query") || "",
    ),
    [platform, setPlatform] = useState("tx"),
    [searchType, setSearchType] = useState("song"),
    [results, setResults] = useState([]),
    [loading, setLoading] = useState(false),
    [sourceId, setSourceId] = useState(""),
    [quality, setQuality] = useState("320k"),
    [error, setError] = useState("");
  const [target, setTarget] = useState("nas");
  const [downloadBusy, setDownloadBusy] = useState("");
  const [pending, setPending] = useState([]),
    [selectedPending, setSelectedPending] = useState([]);
  useEffect(() => {
    if (!ready.some((source) => source.id === sourceId))
      setSourceId(ready[0]?.id || "");
  }, [sources, sourceId]);
  const selected = ready.find((source) => source.id === sourceId);
  const loadPending = async () => {
    try {
      const data = await api("/api/downloads/pending");
      setPending(data.items || []);
    } catch {}
  };
  useEffect(() => {
    loadPending();
    localStorage.removeItem("songlib-download-query");
  }, []);
  useEffect(() => {
    const refresh = () => refreshSources?.().catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSources]);
  const submit = async (event) => {
    event.preventDefault();
    if (!query.trim() || !sourceId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/sources/${sourceId}/test-search`, {
        method: "POST",
        body: JSON.stringify({
          keyword: query,
          platform: platform === "all" ? "tx" : platform,
        }),
      });
      setResults(data.results || []);
      await refreshSources?.();
    } catch (err) {
      setError(`搜索失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  const albumGroups = useMemo(
    () =>
      Object.values(
        results.reduce((map, item) => {
          const key = `${item.album || "单曲"}-${item.artist}`;
          map[key] ||= {
            album: item.album || "单曲",
            artist: item.artist,
            coverUrl: item.coverUrl,
            tracks: [],
          };
          map[key].tracks.push(item);
          return map;
        }, {}),
      ),
    [results],
  );
  const deviceDownload = async (item) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = `下载 ${item.title || "歌曲"}`;
    document.body.appendChild(frame);
    try {
      const data = await api("/api/downloads/device-token", {
        method: "POST",
        body: JSON.stringify({ item, sourceId, quality }),
      });
      frame.src = data.downloadUrl;
      window.setTimeout(() => frame.remove(), 120000);
      notify?.(
        `《${item.title}》已开始下载到当前设备${data.qualityFallback ? `（自动使用 ${data.quality}）` : ""}`,
      );
    } catch (downloadError) {
      frame.remove();
      throw downloadError;
    }
  };
  const downloadOne = async (item) => {
    const busyKey = `${item.platform}-${item.trackId || item.id}`;
    setDownloadBusy(busyKey);
    setError("");
    try {
      if (target === "device") {
        await deviceDownload(item);
        return;
      }
      await createDownload(item, sourceId, quality);
      await loadPending();
    } catch (downloadError) {
      setError(`下载失败：${downloadError.message}`);
      notify?.(`《${item.title}》下载失败：${downloadError.message}`);
    } finally {
      setDownloadBusy("");
    }
  };
  const downloadMany = async (items) => {
    setDownloadBusy("batch");
    setError("");
    try {
      if (target === "device") {
        for (const item of items) await deviceDownload(item);
        notify?.(`已向当前设备发起 ${items.length} 个下载`);
        return;
      }
      for (const item of items) await createDownload(item, sourceId, quality);
      await loadPending();
      notify?.(`已加入 ${items.length} 首歌曲到待入库流程`);
    } catch (downloadError) {
      setError(`批量下载中断：${downloadError.message}`);
    } finally {
      setDownloadBusy("");
    }
  };
  const togglePending = (id) =>
    setSelectedPending((value) =>
      value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
    );
  const decide = async (action) => {
    const ids = selectedPending.length
      ? selectedPending
      : pending.map((item) => item.jobId);
    if (!ids.length) return;
    const verb = action === "confirm" ? "确认入库" : "删除下载文件";
    if (
      !confirm(
        `${verb} ${ids.length} 首待入库歌曲？\n\n音屿会创建任务并写入操作记录，确认入库后会触发 Plex 扫描；删除会移入下载回收区。`,
      )
    )
      return;
    await api(
      `/api/downloads/${action === "confirm" ? "batch-confirm" : "batch-cancel"}`,
      { method: "POST", body: JSON.stringify({ jobIds: ids }) },
    );
    setSelectedPending([]);
    await loadPending();
    notify?.(action === "confirm" ? "批量入库任务已创建" : "已移入回收站");
  };
  if (!ready.length)
    return (
      <div className="page download-page">
        <section className="download-hero">
          <div>
            <span className="eyebrow">
              <ArrowDownToLine />
              MUSIC DOWNLOAD
            </span>
            <h1>搜索音乐，保存到你的 NAS。</h1>
            <p>导入并识别音乐接口后即可搜索与下载。</p>
          </div>
        </section>
        <section className="panel download-empty">
          <Empty
            icon={Wifi}
            title="暂无可用音乐源"
            text="导入音乐源并识别到接口后会自动启用，无需先做搜索或解析测试。"
          />
          <button className="primary" onClick={() => navigate("sources")}>
            <Wifi />
            去音乐源管理
          </button>
        </section>
        <DownloadInboxPanel notify={notify} navigate={navigate} />
      </div>
    );
  return (
    <div className="page download-page">
      <section className="download-hero">
        <div>
          <span className="eyebrow">
            <ArrowDownToLine />
            MUSIC DOWNLOAD
          </span>
          <h1>
            搜索音乐，
            {target === "device" ? "下载到当前设备。" : "保存到你的 NAS。"}
          </h1>
          <p>
            {target === "device"
              ? "当前设备模式会直接触发浏览器下载，适合电脑或手机临时保存。"
              : "下载文件先进入临时区，确认元数据与目录结构后再批量入库。"}
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary" onClick={loadPending}>
            <RefreshCw />
            刷新待入库
          </button>
          <button className="secondary" onClick={() => navigate("sources")}>
            <Settings />
            管理音乐源
          </button>
        </div>
      </section>
      <section className="source-strip download-controls">
        <div className="source-summary">
          <div className="status-orb">
            <Wifi />
          </div>
          <div>
            <strong>{ready.length} 个已启用来源</strong>
            <span>
              {selected?.resolveOk
                ? "最近一次地址解析成功"
                : "接口已授权，下载时实时解析"}
            </span>
          </div>
        </div>
        <div className="target-toggle">
          <button
            className={target === "nas" ? "active" : ""}
            onClick={() => setTarget("nas")}
          >
            <Server />
            NAS 入库
          </button>
          <button
            className={target === "device" ? "active" : ""}
            onClick={() => setTarget("device")}
          >
            <Download />
            当前设备
          </button>
        </div>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {ready.map((source) => (
            <option value={source.id} key={source.id}>
              {source.displayName}
            </option>
          ))}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="tx">QQ 音乐</option>
          <option value="wy">网易云</option>
          <option value="all">全源</option>
        </select>
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value)}
        >
          <option value="song">歌曲</option>
          <option value="album">专辑</option>
          <option value="artist">歌手</option>
          <option value="playlist">歌单</option>
        </select>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="128k">标准 128K</option>
          <option value="320k">高品质 320K</option>
          <option value="flac">无损 FLAC</option>
          <option value="flac24bit">Hi-Res</option>
        </select>
      </section>
      <form className="catalog-search" onSubmit={submit}>
        <div className="big-search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲、专辑名、歌手或歌单"
          />
          <button className="primary" disabled={loading || !selected}>
            {loading ? <LoaderCircle className="spin" /> : "搜索"}
          </button>
        </div>
      </form>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <section className="search-results panel">
        <SectionHead
          title={searchType === "album" ? "专辑结果" : "搜索结果"}
          note={
            results.length
              ? `找到 ${results.length} 首候选歌曲 · 当前目标：${target === "device" ? "当前设备" : "NAS 待入库"}`
              : "可解析的歌曲可加入下载队列"
          }
        />
        {loading ? (
          <PageLoader />
        ) : results.length ? (
          searchType === "album" ? (
            <div className="album-results">
              {albumGroups.map((group) => (
                <article
                  className="album-result"
                  key={`${group.album}-${group.artist}`}
                >
                  <div className="result-cover big">
                    {group.coverUrl ? <img src={group.coverUrl} /> : <Album />}
                  </div>
                  <div>
                    <strong>{group.album}</strong>
                    <span>
                      {group.artist} · {group.tracks.length} 首 ·{" "}
                      {platform === "tx"
                        ? "QQ 音乐"
                        : platform === "wy"
                          ? "网易云"
                          : "全源"}
                    </span>
                    <div className="quality-dots">
                      <i>{quality}</i>
                      <i>
                        {target === "device" ? "浏览器下载" : "本地匹配待检查"}
                      </i>
                    </div>
                  </div>
                  <div className="album-actions">
                    <button
                      className="secondary small"
                      onClick={() => setResults(group.tracks)}
                    >
                      查看曲目
                    </button>
                    <button
                      className="primary small"
                      onClick={() => downloadMany(group.tracks)}
                    >
                      <Download />
                      {target === "device" ? "下载到设备" : "下载整张专辑"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="result-list">
              {results.map((item) => (
                <div
                  className="result-row"
                  key={`${item.platform}-${item.trackId}`}
                >
                  <div className="result-cover">
                    {item.coverUrl ? <img src={item.coverUrl} /> : <Music2 />}
                  </div>
                  <div className="result-main">
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist} · {item.album || "单曲"}
                    </span>
                  </div>
                  <span className="duration">
                    {Math.floor(item.duration / 60)}:
                    {String(item.duration % 60).padStart(2, "0")}
                  </span>
                  <div className="quality-dots">
                    {item.qualities.slice(-2).map((q) => (
                      <i key={q}>{q}</i>
                    ))}
                  </div>
                  <div className="row-actions wide">
                    <button
                      title="试听"
                      onClick={() =>
                        playPreview?.({
                          ...item,
                          source: "source_preview",
                          sourceId,
                          quality,
                          item,
                        })
                      }
                    >
                      <Play />
                    </button>
                    <button
                      title={
                        target === "device"
                          ? "下载到当前设备"
                          : "下载并加入待入库"
                      }
                      disabled={
                        !!downloadBusy &&
                        downloadBusy !== `${item.platform}-${item.trackId || item.id}`
                      }
                      className="download-action-button"
                      onClick={() => downloadOne(item)}
                    >
                      {downloadBusy === `${item.platform}-${item.trackId || item.id}` ? (
                        <LoaderCircle className="spin" />
                      ) : (
                        <Download />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <Empty
            icon={Search}
            title="搜索歌曲、专辑或歌手"
            text="结果会展示歌手、专辑、时长与可选音质。"
          />
        )}
      </section>
      <section className="panel pending-ingest">
        <SectionHead
          title="待入库"
          note={`${pending.length} 首歌曲已下载到临时区，尚未进入正式曲库`}
          action={
            <div className="pending-actions">
              <button
                className="secondary small"
                disabled={!pending.length}
                onClick={() => decide("cancel")}
              >
                <Trash2 />
                批量删除下载文件
              </button>
              <button
                className="primary small"
                disabled={!pending.length}
                onClick={() => decide("confirm")}
              >
                <Check />
                批量确认入库
              </button>
            </div>
          }
        />
        {pending.length ? (
          <div className="pending-table">
            <div className="pending-row pending-head">
              <span></span>
              <span>歌曲</span>
              <span>来源 / 音质</span>
              <span>当前位置 / 入库位置</span>
              <span>状态</span>
            </div>
            {pending.map((item) => (
              <div className="pending-row" key={item.jobId}>
                <input
                  type="checkbox"
                  checked={selectedPending.includes(item.jobId)}
                  onChange={() => togglePending(item.jobId)}
                />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.artist} · {item.album}
                  </small>
                </div>
                <span>
                  {item.source || "音乐源"} · {item.quality}
                </span>
                <div className="pending-paths">
                  <code>{item.currentPath || item.downloadPath}</code>
                  <ChevronRight />
                  <code>{item.proposedPath || item.targetPath}</code>
                </div>
                <div className="file-flags">
                  <i className="pending-stage">
                    {item.stageLabel || "临时区 · 待确认"}
                  </i>
                  <i className={item.tagStatus === "标签已准备" ? "ok" : ""}>
                    {item.tagStatus}
                  </i>
                  <i className={item.coverStatus === "封面已准备" ? "ok" : ""}>
                    {item.coverStatus}
                  </i>
                  <i className={item.lyricStatus === "歌词已准备" ? "ok" : ""}>
                    {item.lyricStatus}
                  </i>
                  <i className={!item.conflict ? "ok" : ""}>
                    {item.conflict ? "冲突" : "无冲突"}
                  </i>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={Download}
            title="暂无待入库歌曲"
            text="下载完成后，歌曲会在这里等待批量确认入库。"
          />
        )}
      </section>
    </div>
  );
}

function Tasks({ jobs, refresh, navigate }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("running");
  const inspect = async (id) => {
    try {
      setDetail(await api(`/api/jobs/${id}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const control = async (job, action) => {
    if (!confirm(`${action === "retry" ? "重试" : "安全取消"}：${job.title}？`)) return;
    try {
      await api(`/api/jobs/${job.id}/${action}`, { method: "POST" });
      setDetail(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const label = (status) =>
    status === "running"
      ? "执行中"
      : status === "completed"
        ? "完成"
        : status === "failed"
          ? "失败"
          : status === "waiting_confirm"
            ? "待确认"
            : status === "cancelled"
              ? "已取消"
              : "排队";
  const groups = {
    running: jobs.filter((j) => ["running", "queued"].includes(j.status)),
    confirm: jobs.filter((j) => j.status === "waiting_confirm"),
    failed: jobs.filter((j) => j.status === "failed"),
    history: jobs.filter(
      (j) =>
        !["running", "queued", "waiting_confirm", "failed"].includes(j.status),
    ),
    all: jobs,
  };
  const visible = groups[filter] || jobs;
  return (
    <div className="page tasks-page">
      <SectionHead
        title="任务中心"
        note="运行中、待确认、失败和历史任务分开处理"
        action={
          <button className="secondary small" onClick={refresh}>
            <RefreshCw />
            刷新
          </button>
        }
      />
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      <div className="task-summary">
        <button
          className={filter === "running" ? "active" : ""}
          onClick={() => setFilter("running")}
        >
          <LoaderCircle />
          <strong>{groups.running.length}</strong>
          <span>正在执行</span>
        </button>
        <button
          className={filter === "confirm" ? "active" : ""}
          onClick={() => setFilter("confirm")}
        >
          <WandSparkles />
          <strong>{groups.confirm.length}</strong>
          <span>待我确认</span>
        </button>
        <button
          className={filter === "failed" ? "active" : ""}
          onClick={() => setFilter("failed")}
        >
          <CircleAlert />
          <strong>{groups.failed.length}</strong>
          <span>失败任务</span>
        </button>
        <button
          className={filter === "history" ? "active" : ""}
          onClick={() => setFilter("history")}
        >
          <Check />
          <strong>{groups.history.length}</strong>
          <span>历史记录</span>
        </button>
      </div>
      <section className="panel task-list">
        <div className="task-list-head">
          <span>任务</span>
          <span>状态</span>
          <span>时间</span>
        </div>
        {visible.length ? (
          visible.map((job) => (
            <div
              className="task-detail"
              key={job.id}
              onClick={() => inspect(job.id)}
            >
              <div className={`job-state ${job.status}`}>
                {job.status === "running" ? (
                  <LoaderCircle className="spin" />
                ) : job.status === "completed" ? (
                  <Check />
                ) : job.status === "failed" ? (
                  <CircleAlert />
                ) : job.status === "waiting_confirm" ? (
                  <WandSparkles />
                ) : (
                  <Clock3 />
                )}
              </div>
              <div className="task-copy">
                <strong>{job.title}</strong>
                <span>
                  {job.error_message ||
                    job.message ||
                    `任务 #${job.id} · 发起时间 ${timeAgo(job.created_at)}`}
                </span>
                {!["queued", "running", "waiting_confirm"].includes(job.status) && (
                  <small>成功 {job.success_count || 0} · 失败 {job.failed_count || 0} · 跳过 {job.skipped_count || 0}</small>
                )}
                {job.status === "running" && (
                  <div className="bar">
                    <i
                      className="amber"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}
                {job.status === "waiting_confirm" && (
                  <div className="inline-task-actions">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate?.("download");
                      }}
                    >
                      打开待入库
                    </button>
                  </div>
                )}
                {["running", "queued"].includes(job.status) && (
                  <div className="inline-task-actions">
                    <button onClick={(event) => { event.stopPropagation(); control(job, "cancel"); }}>
                      取消任务
                    </button>
                  </div>
                )}
                {["failed", "cancelled"].includes(job.status) && (
                  <div className="inline-task-actions">
                    <button className="confirm" onClick={(event) => { event.stopPropagation(); control(job, "retry"); }}>
                      重试
                    </button>
                  </div>
                )}
              </div>
              <em className={`status-pill ${job.status}`}>
                {label(job.status)}
              </em>
              <time>{timeAgo(job.created_at)}</time>
            </div>
          ))
        ) : (
          <Empty
            icon={Activity}
            title="这一类暂时没有任务"
            text="任务会按运行、确认、失败和历史自动归类。"
          />
        )}
      </section>
      {detail && (
        <div className="modal-wrap">
          <button className="modal-backdrop" onClick={() => setDetail(null)} />
          <section className="modal panel log-modal job-modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">任务详情</span>
                <h3>{detail.title}</h3>
              </div>
              <button className="icon-button" onClick={() => setDetail(null)}>
                <X />
              </button>
            </div>
            <dl className="task-detail-meta">
              <div>
                <dt>任务名称</dt>
                <dd>{detail.title}</dd>
              </div>
              <div>
                <dt>开始时间</dt>
                <dd>
                  {detail.created_at
                    ? new Date(detail.created_at).toLocaleString("zh-CN")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>当前进度</dt>
                <dd>{detail.progress || 0}%</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{label(detail.status)}</dd>
              </div>
              <div>
                <dt>执行范围</dt>
                <dd>{detail.payload?.scope || "全部"}{detail.payload?.scopeValue ? ` · ${detail.payload.scopeValue}` : ""}</dd>
              </div>
              <div>
                <dt>结果</dt>
                <dd>成功 {detail.success_count || 0} · 失败 {detail.failed_count || 0} · 跳过 {detail.skipped_count || 0}</dd>
              </div>
              <div>
                <dt>结束时间</dt>
                <dd>{detail.finished_at ? new Date(detail.finished_at).toLocaleString("zh-CN") : "—"}</dd>
              </div>
            </dl>
            {detail.error_message && (
              <div className="inline-error">
                <CircleAlert />
                {detail.error_code}: {detail.error_message}
              </div>
            )}
            {detail.status === "waiting_confirm" && detail.result?.preview && (
              <div className="ingest-preview">
                <div>
                  <small>临时文件</small>
                  <code>{detail.result.preview.incomingPath}</code>
                </div>
                <ChevronRight />
                <div>
                  <small>目标路径</small>
                  <code>{detail.result.preview.targetPath}</code>
                </div>
                <dl>
                  <div>
                    <dt>歌曲</dt>
                    <dd>{detail.result.preview.title}</dd>
                  </div>
                  <div>
                    <dt>歌手 / 专辑</dt>
                    <dd>
                      {detail.result.preview.artist} ·{" "}
                      {detail.result.preview.album}
                    </dd>
                  </div>
                  <div>
                    <dt>音质</dt>
                    <dd>{detail.result.preview.quality}</dd>
                  </div>
                  <div>
                    <dt>冲突</dt>
                    <dd>
                      {detail.result.preview.conflictAdjusted
                        ? "已自动使用安全新文件名"
                        : "无"}
                    </dd>
                  </div>
                </dl>
                <div className="decision-actions">
                  <button className="primary" onClick={() => { setDetail(null); navigate?.("download"); }}>
                    <ArrowDownToLine />打开待入库批量处理
                  </button>
                </div>
              </div>
            )}
            <div className="decision-actions">
              {["running", "queued"].includes(detail.status) && (
                <button className="secondary" onClick={() => control(detail, "cancel")}><X />取消任务</button>
              )}
              {["failed", "cancelled"].includes(detail.status) && (
                <button className="primary" onClick={() => control(detail, "retry")}><RefreshCw />重试任务</button>
              )}
            </div>
            <div className="log-list">
              {detail.logs?.map((item) => (
                <div className={item.level} key={item.id}>
                  <time>
                    {new Date(item.created_at).toLocaleString("zh-CN")}
                  </time>
                  <p>{item.message}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  settings,
  logout,
  navigate,
  isAdmin = true,
  onSettingsChange,
  appearance = DEFAULT_APPEARANCE,
  onAppearanceChange,
}) {
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [message, setMessage] = useState("");
  const [tab, setTab] = useState(isAdmin ? "operations" : "appearance"),
    [draft, setDraft] = useState({}),
    [plexOpen, setPlexOpen] = useState(false),
    [plex, setPlex] = useState(settings.plex || {});
  const [profile, setProfile] = useState(settings.user || {}),
    [logs, setLogs] = useState(null),
    [logsLoading, setLogsLoading] = useState(false);
  const [fnosDraft, setFnosDraft] = useState({
    serverUrl: settings.fnosMusic?.serverUrl || "",
    authMode: settings.fnosMusic?.authMode || "password",
    username: settings.fnosMusic?.accountLabel || "",
    password: "",
    token: "",
  });
  const [backups, setBackups] = useState([]),
    [backupBusy, setBackupBusy] = useState("");
  const defaultPlayerPrefs = {
    defaultSource: "local_first",
    remoteBitrate: "320k",
    autoTranscode: false,
    showLyrics: true,
    blurBackground: true,
    extractColor: true,
  };
  const [playerPrefs, setPlayerPrefs] = useState({
    ...defaultPlayerPrefs,
    ...(settings.player || {}),
  });
  const appearancePrefs = normalizeAppearance(appearance);
  const updateAppearance = (key, value) =>
    onAppearanceChange?.({ ...appearancePrefs, [key]: value });
  useEffect(() => {
    setDraft(settings || {});
    setPlex(settings.plex || {});
    setProfile(settings.user || {});
    setFnosDraft((value) => ({
      ...value,
      serverUrl: settings.fnosMusic?.serverUrl || "",
      authMode: settings.fnosMusic?.authMode || "password",
      username: settings.fnosMusic?.accountLabel || "",
      password: "",
      token: "",
    }));
    setPlayerPrefs({ ...defaultPlayerPrefs, ...(settings.player || {}) });
  }, [settings]);
  useEffect(() => {
    if (!isAdmin && !["appearance", "user"].includes(tab)) setTab("appearance");
  }, [isAdmin, tab]);
  const change = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setMessage("密码已更新，请重新登录");
      setTimeout(logout, 1200);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const save = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改系统设置权限");
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ values: draft }),
    });
    setMessage("设置已保存");
  };
  const savePlayerPrefs = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改播放器全局偏好权限");
    const values = { ...draft, player: playerPrefs };
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ values }),
    });
    setDraft(values);
    setMessage("播放器偏好已保存，播放器页面会立即按“显示歌词”等选项刷新。");
  };
  const togglePlayerPref = (key) =>
    setPlayerPrefs((value) => ({ ...value, [key]: !value[key] }));
  const saveProfile = async (values) => {
    const result = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ values }),
    });
    setProfile(result.profile);
    onSettingsChange?.((value) => ({ ...value, user: result.profile }));
    setMessage("个人资料已保存");
  };
  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api("/api/profile/avatar", { method: "POST", body });
      setProfile(result.profile);
      setMessage("头像已更新，刷新页面后顶部菜单也会同步。");
    } catch (err) {
      setMessage(err.message);
    } finally {
      event.target.value = "";
    }
  };
  const loadLogs = async () => {
    if (!isAdmin) return;
    setLogsLoading(true);
    try {
      setLogs(await api("/api/logs/summary?limit=120"));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLogsLoading(false);
    }
  };
  const loadBackups = async () => {
    try {
      const data = await api("/api/backups");
      setBackups(data.items || []);
    } catch (err) {
      setMessage(err.message);
    }
  };
  const createBackup = async () => {
    setBackupBusy("create");
    try {
      await api("/api/backups", { method: "POST" });
      setMessage("数据库备份已创建");
      await loadBackups();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBackupBusy("");
    }
  };
  const restoreBackup = async (item) => {
    if (
      !confirm(
        `恢复备份 ${item.name}？\n\n当前账号、设置、任务和索引会回到该备份时间。音乐文件不会被覆盖。`,
      )
    )
      return;
    setBackupBusy(item.name);
    try {
      const result = await api(
        `/api/backups/${encodeURIComponent(item.name)}/restore`,
        { method: "POST" },
      );
      setMessage(result.message);
      setTimeout(logout, 1200);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBackupBusy("");
    }
  };
  useEffect(() => {
    if (tab === "logs") {
      if (!logs) loadLogs();
      loadBackups();
    }
  }, [tab]);
  const refreshPlex = async () => setPlex(await api("/api/settings/plex"));
  const syncPlex = async () => {
    try {
      await api("/api/plex/sync", { method: "POST" });
      setMessage("Plex 同步任务已加入队列");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const testSavedPlex = async () => {
    try {
      const result = await api("/api/plex/test", {
        method: "POST",
        body: JSON.stringify({ serverUrl: plex.serverUrl, token: "" }),
      });
      setMessage(result.message || "Plex 连接成功");
      await refreshPlex();
    } catch (err) {
      setMessage(err.message);
    }
  };
  const testFnosMusic = async () => {
    try {
      const result = await api("/api/settings/fnos/test", { method: "POST" });
      setMessage(result.message || "飞牛音乐连接成功");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const saveFnosMusic = async () => {
    if (!isAdmin) return setMessage("当前账号没有修改连接的权限");
    try {
      const result = await api("/api/settings/fnos", {
        method: "POST",
        body: JSON.stringify(fnosDraft),
      });
      setFnosDraft((value) => ({
        ...value,
        password: "",
        token: "",
        ...result.fnosMusic,
        username: result.fnosMusic?.accountLabel || value.username,
      }));
      onSettingsChange?.((value) => ({
        ...value,
        fnosMusic: result.fnosMusic,
      }));
      setMessage(result.message || "飞牛音乐连接已保存");
    } catch (err) {
      setMessage(err.message);
    }
  };
  const tabs = isAdmin
    ? [
        ["operations", "管理工具", Gauge],
        ["plex", "Plex 连接", Server],
        ["paths", "本地路径", FolderTree],
        ["ingest", "下载与入库", ArrowDownToLine],
        ["scrape", "刮削规则", WandSparkles],
        ["naming", "命名规则", Tags],
        ["exclude", "扫描排除", ShieldCheck],
        ["appearance", "外观与主题", Palette],
        ["player", "播放器", Play],
        ["user", "用户与安全", UserRound],
        ["logs", "备份与日志", ScrollText],
      ]
    : [
        ["appearance", "外观与主题", Palette],
        ["user", "用户与安全", UserRound],
      ];
  const templates = draft.namingTemplates || settings.namingTemplates || {};
  const scrapeRules = draft.scrapeRules || settings.scrapeRules || {
    defaultMode: "missing",
    writeCover: true,
    writeLyrics: true,
    refreshPlex: true,
    skipExistingCover: true,
    skipExistingLyrics: true,
  };
  const templateLabels = {
    album: "普通专辑",
    multiDisc: "多碟专辑",
    compilation: "合辑",
    unknown: "信息不完整",
  };
  const templateExample = (value) =>
    String(value || "")
      .replaceAll("{artist}", "周杰伦")
      .replaceAll("{album}", "叶惠美")
      .replaceAll("{year}", "2003")
      .replaceAll("{discNumber}", "2")
      .replaceAll("{trackNumber}", "03")
      .replaceAll("{title}", "晴天")
      .replaceAll("{ext}", "flac");
  return (
    <div className="page settings-page">
      <div className="settings-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      <section className="panel settings-workbench">
        {message && (
          <div className="inline-info">
            <ShieldCheck />
            {message}
          </div>
        )}
        {tab === "operations" && (
          <div className="settings-operations">
            <header>
              <span>ADMINISTRATION</span>
              <h2>管理工具</h2>
              <p>这些功能也会在一级“音乐工具”中直接显示；这里保留快捷入口。</p>
            </header>
            <div className="settings-operations-grid">
              {managementNav
                .filter((item) => item.id !== "settings")
                .map((item) => (
                  <button key={item.id} onClick={() => navigate(item.id)}>
                    <span><item.icon /></span>
                    <span><strong>{item.label}</strong><small>{item.desc}</small></span>
                    <ChevronRight />
                  </button>
                ))}
            </div>
          </div>
        )}
        {tab === "plex" && (
          <div className="settings-grid">
            <SettingBlock
              icon={Server}
              title="Plex 连接"
              note="Plex 负责展示、播放、扫描、刷新与远程播放。"
            >
              <dl>
                <div>
                  <dt>启用状态</dt>
                  <dd>{plex.enabled ? "已启用" : "未启用"}</dd>
                </div>
                <div>
                  <dt>服务器名称</dt>
                  <dd>{plex.name || settings.plexServerName}</dd>
                </div>
                <div>
                  <dt>Plex 地址</dt>
                  <dd>{plex.serverUrl || settings.plexUrl}</dd>
                </div>
                <div>
                  <dt>外网播放地址</dt>
                  <dd>{plex.externalUrl || settings.externalPlexUrl}</dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>{plex.hasToken ? "已保存" : "未保存"}</dd>
                </div>
                <div>
                  <dt>同步媒体库</dt>
                  <dd>
                    {plex.selectedLibraryKeys === "all"
                      ? "全部音乐库"
                      : (plex.selectedLibraryKeys || []).join(", ") ||
                        "未选择"}{" "}
                    · {plex.syncedLibraryCount || 0} 个
                  </dd>
                </div>
                <div>
                  <dt>最近连接</dt>
                  <dd>
                    {plex.lastConnectedAt
                      ? timeAgo(plex.lastConnectedAt)
                      : "尚未测试"}
                  </dd>
                </div>
                <div>
                  <dt>最近同步</dt>
                  <dd>
                    {plex.lastSyncAt ? timeAgo(plex.lastSyncAt) : "尚未同步"}
                  </dd>
                </div>
              </dl>
              <div className="setting-actions">
                <button
                  className="primary small"
                  onClick={() => setPlexOpen(true)}
                >
                  <Settings />
                  配置 Plex
                </button>
                <button className="secondary small" onClick={testSavedPlex}>
                  <TestTube2 />
                  测试连接
                </button>
                <button className="secondary small" onClick={syncPlex}>
                  <RefreshCw />
                  立即同步
                </button>
              </div>
            </SettingBlock>
            <SettingBlock
              icon={Library}
              title="Plex 音乐资料库"
              note="配置窗口中可以刷新并选择全部或指定音乐库。"
            >
              {plex.libraries?.length ? (
                <div className="plex-library-chips">
                  {plex.libraries.map((item) => (
                    <span
                      key={item.key}
                      className={item.enabled ? "active" : ""}
                    >
                      {item.title}
                      <small>#{item.key}</small>
                    </span>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Library}
                  title="未读取到音乐库"
                  text="请先在配置窗口测试连接并刷新媒体库列表。"
                />
              )}
            </SettingBlock>
            <SettingBlock
              icon={Radio}
              title="飞牛音乐"
              note="连接后可将歌单按原顺序同步到飞牛音乐。"
            >
              <dl>
                <div>
                  <dt>服务地址</dt>
                  <dd>{settings.fnosMusic?.serverUrl || "未配置"}</dd>
                </div>
                <div>
                  <dt>连接状态</dt>
                  <dd>{settings.fnosMusic?.configured ? "已连接" : "待配置"}</dd>
                </div>
                <div>
                  <dt>认证方式</dt>
                  <dd>
                    {settings.fnosMusic?.configured
                      ? settings.fnosMusic?.authMode === "password"
                        ? "飞牛音乐账号"
                        : "服务令牌"
                      : "飞牛音乐账号或服务令牌"}
                  </dd>
                </div>
              </dl>
              <div className="fnos-config-form">
                <label>
                  服务地址
                  <input
                    value={fnosDraft.serverUrl}
                    placeholder="http://NAS地址:5666"
                    onChange={(event) =>
                      setFnosDraft((value) => ({
                        ...value,
                        serverUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  认证方式
                  <select
                    value={fnosDraft.authMode}
                    onChange={(event) =>
                      setFnosDraft((value) => ({
                        ...value,
                        authMode: event.target.value,
                        password: "",
                        token: "",
                      }))
                    }
                  >
                    <option value="password">飞牛音乐账号</option>
                    <option value="token">服务令牌</option>
                  </select>
                </label>
                {fnosDraft.authMode === "password" ? (
                  <>
                    <label>
                      飞牛音乐账号
                      <input
                        autoComplete="username"
                        value={fnosDraft.username}
                        onChange={(event) =>
                          setFnosDraft((value) => ({
                            ...value,
                            username: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      飞牛音乐密码
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={fnosDraft.password}
                        placeholder={
                          settings.fnosMusic?.configured
                            ? "重新连接时输入"
                            : "仅用于换取服务会话"
                        }
                        onChange={(event) =>
                          setFnosDraft((value) => ({
                            ...value,
                            password: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label className="fnos-token-field">
                    服务令牌
                    <input
                      type="password"
                      autoComplete="off"
                      value={fnosDraft.token}
                      placeholder={
                        settings.fnosMusic?.configured
                          ? "如需替换请输入新令牌"
                          : "music-token"
                      }
                      onChange={(event) =>
                        setFnosDraft((value) => ({
                          ...value,
                          token: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
              </div>
              <p className="setting-explainer">
                账号密码只用于向飞牛音乐换取服务会话，密码不会保存。派生令牌保存在
                NAS 的受保护数据目录中，也不会回显到页面。
              </p>
              <div className="setting-actions">
                <button className="primary small" onClick={saveFnosMusic}>
                  <Check />
                  保存并连接
                </button>
                <button
                  className="secondary small"
                  onClick={testFnosMusic}
                  disabled={!settings.fnosMusic?.configured}
                >
                  <TestTube2 />
                  测试连接
                </button>
                <button className="secondary small" onClick={() => navigate?.("playlists")}>
                  <ListMusic />
                  打开歌单
                </button>
              </div>
            </SettingBlock>
            <SettingBlock
              icon={Activity}
              title="系统信息"
              note="当前部署版本与运行限制。"
            >
              <dl>
                <div>
                  <dt>产品</dt>
                  <dd>{BRAND.fullName}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>v{settings.version || BRAND.version}</dd>
                </div>
                <div>
                  <dt>音乐源文件限制</dt>
                  <dd>{settings.sourceMaxSizeMb} MB</dd>
                </div>
                <div>
                  <dt>单音频限制</dt>
                  <dd>{settings.maxDownloadMb} MB</dd>
                </div>
              </dl>
            </SettingBlock>
          </div>
        )}
        {tab === "paths" && (
          <div className="settings-grid">
            <SettingBlock
              icon={FolderTree}
              title="本地路径"
              note="这里显示音屿可以读取和整理的音乐目录。"
            >
              <dl>
                <div>
                  <dt>正式音乐库</dt>
                  <dd>{settings.musicRoot}</dd>
                </div>
                <div>
                  <dt>授权下载暂存区</dt>
                  <dd>{settings.downloadTempDir}</dd>
                </div>
                <div>
                  <dt>下载处理中转区</dt>
                  <dd>{settings.incomingDir}</dd>
                </div>
                <div>
                  <dt>下载接收目录</dt>
                  <dd>{settings.manualDownloadDir}</dd>
                </div>
                <div>
                  <dt>音乐库回收站</dt>
                  <dd>{settings.trashDir}</dd>
                </div>
                <div>
                  <dt>下载回收站</dt>
                  <dd>{settings.downloadTrashDir}</dd>
                </div>
              </dl>
            </SettingBlock>
            <SettingBlock
              icon={Image}
              title="保存规则"
              note="封面与歌词优先保存到本地曲库。"
            >
              <dl>
                <div>
                  <dt>歌词保存</dt>
                  <dd>{settings.lyricRule}</dd>
                </div>
                <div>
                  <dt>封面保存</dt>
                  <dd>{settings.coverRule}</dd>
                </div>
              </dl>
            </SettingBlock>
          </div>
        )}
        {tab === "ingest" && (
          <div className="settings-grid">
            <SettingBlock
              icon={Download}
              title="下载与入库"
              note="下载先进入临时目录，再批量确认到正式曲库。"
            >
              <dl>
                <div>
                  <dt>临时下载</dt>
                  <dd>{settings.downloadTempDir}</dd>
                </div>
                <div>
                  <dt>待入库</dt>
                  <dd>{settings.incomingDir}</dd>
                </div>
                <div>
                  <dt>正式曲库</dt>
                  <dd>{settings.musicRoot}</dd>
                </div>
              </dl>
              <button
                className="primary small"
                onClick={() => navigate?.("download")}
              >
                <Check />
                打开待入库
              </button>
            </SettingBlock>
            <SettingBlock
              icon={RotateCcw}
              title="回滚策略"
              note="移动、标签写入与下载入库均记录操作日志。"
            >
              <p className="setting-copy">
                确认入库前会检查冲突；取消入库会移动到回收站目录。
              </p>
            </SettingBlock>
          </div>
        )}
        {tab === "scrape" && (
          <SettingBlock
            icon={WandSparkles}
            title="刮削规则"
            note="默认只补缺失；覆盖模式仍需在刮削中心逐次确认。"
          >
            <div className="settings-switches">
              <label>
                默认模式
                <select
                  value={scrapeRules.defaultMode}
                  onChange={(e) => setDraft((value) => ({ ...value, scrapeRules: { ...scrapeRules, defaultMode: e.target.value } }))}
                >
                  <option value="missing">只补缺失</option>
                  <option value="incremental">增量更新</option>
                  <option value="refresh">全量刷新</option>
                  <option value="force">强制覆盖</option>
                </select>
              </label>
              {[
                ["写入 cover.jpg", "writeCover"],
                ["写入同名 .lrc", "writeLyrics"],
                ["完成后刷新 Plex", "refreshPlex"],
                ["跳过已有封面", "skipExistingCover"],
                ["跳过已有歌词", "skipExistingLyrics"],
              ].map(([label, key]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!scrapeRules[key]}
                    onChange={() => setDraft((value) => ({ ...value, scrapeRules: { ...scrapeRules, [key]: !scrapeRules[key] } }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <button className="secondary small" onClick={save}><Check />保存刮削规则</button>
          </SettingBlock>
        )}
        {tab === "naming" && (
          <SettingBlock
            icon={Tags}
            title="命名规则"
            note="模板会在整理预览中生成目标路径。"
          >
            <div className="template-list">
              {Object.entries(templates).map(([key, value]) => (
                <label key={key}>
                  {templateLabels[key] || key}
                  <input
                    value={value}
                    onChange={(e) =>
                      setDraft((v) => ({
                        ...v,
                        namingTemplates: {
                          ...(v.namingTemplates || templates),
                          [key]: e.target.value,
                        },
                      }))
                    }
                  />
                  <small>
                    示例：
                    {templateExample(value)}
                  </small>
                </label>
              ))}
            </div>
            <button className="secondary small" onClick={save}>
              <Check />
              保存命名模板
            </button>
          </SettingBlock>
        )}
        {tab === "exclude" && (
          <SettingBlock
            icon={ShieldCheck}
            title="扫描排除规则"
            note="这些目录不会被当作正式曲库扫描。"
          >
            <label className="exclude-editor">
              每行一个目录
              <textarea
                value={(draft.excludeDirs || settings.excludeDirs || []).join(
                  "\n",
                )}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    excludeDirs: event.target.value
                      .split(/\r?\n/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
            <button className="secondary small" onClick={save}>
              <Check />
              保存排除规则
            </button>
          </SettingBlock>
        )}
        {tab === "appearance" && (
          <div className="settings-grid appearance-settings-grid">
            <SettingBlock
              icon={Palette}
              title="外观与主题"
              note="调整会即时预览，并保存在当前设备；无需重启服务。"
            >
              <div className="theme-choice" role="group" aria-label="界面主题">
                {[
                  ["system", "跟随系统"],
                  ["dark", "深色"],
                  ["light", "浅色"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={appearancePrefs.theme === value ? "active" : ""}
                    onClick={() => updateAppearance("theme", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="appearance-sliders">
                {[
                  ["玻璃模糊度", "glassBlur", 8, 44, 1, "px"],
                  ["玻璃透明度", "glassOpacity", 0.2, 0.88, 0.01, "%"],
                  ["背景模糊度", "backdropBlur", 0, 36, 1, "px"],
                  ["背景图可见度", "backdropOpacity", 0.18, 0.9, 0.01, "%"],
                  ["字号大小", "fontScale", 0.9, 1.25, 0.01, "%"],
                  ["圆角大小", "cornerRadius", 12, 32, 1, "px"],
                  ["色彩饱和度", "saturation", 80, 190, 1, "%"],
                  ["动效强度", "motion", 0, 1.2, 0.05, "%"],
                ].map(([label, key, min, max, step, unit]) => {
                  const value = appearancePrefs[key];
                  const formatted =
                    unit === "%"
                      ? `${Math.round(value * (key === "saturation" ? 1 : 100))}%`
                      : `${Math.round(value)}${unit}`;
                  return (
                    <label className="appearance-range" key={key}>
                      <span>
                        <b>{label}</b>
                        <output>{formatted}</output>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(event) =>
                          updateAppearance(key, Number(event.target.value))
                        }
                      />
                    </label>
                  );
                })}
              </div>
              <div className="appearance-live-preview" aria-label="外观设置实时预览">
                <div className="appearance-preview-panel">
                  <span className="appearance-preview-icon"><Music2 /></span>
                  <span className="appearance-preview-copy">
                    <strong>实时预览</strong>
                    <small>拖动滑块时，模糊、透明度、字号、圆角与色彩会立即变化</small>
                  </span>
                  <span className="appearance-preview-chip">正在生效</span>
                </div>
              </div>
              <div className="setting-actions">
                <button
                  className="secondary small"
                  onClick={() => onAppearanceChange?.(DEFAULT_APPEARANCE)}
                >
                  <RotateCcw />
                  恢复推荐值
                </button>
                <button
                  className="primary small"
                  onClick={() => setMessage("外观偏好已保存在当前设备")}
                >
                  <Check />
                  完成
                </button>
              </div>
            </SettingBlock>
          </div>
        )}
        {tab === "player" && (
          <SettingBlock
            icon={Play}
            title="播放器设置"
            note="这些偏好会保存到服务端，并立即影响播放器的歌词显示等行为。"
          >
            <div className="settings-switches">
              {[
                ["本地优先", "defaultSource", true],
                ["远程默认 320K", "remoteBitrate", true],
                ["自动转码", "autoTranscode"],
                ["显示歌词", "showLyrics"],
                ["背景低模糊", "blurBackground"],
                ["封面取色", "extractColor"],
              ].map(([label, key, derived]) => (
                <label
                  key={key}
                  title={
                    derived ? "策略项会参与后续播放解析默认值" : "可立即保存"
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      key === "defaultSource"
                        ? playerPrefs.defaultSource === "local_first"
                        : key === "remoteBitrate"
                          ? playerPrefs.remoteBitrate === "320k"
                          : !!playerPrefs[key]
                    }
                    onChange={() =>
                      key === "defaultSource"
                        ? setPlayerPrefs((v) => ({
                            ...v,
                            defaultSource:
                              v.defaultSource === "local_first"
                                ? "plex_first"
                                : "local_first",
                          }))
                        : key === "remoteBitrate"
                          ? setPlayerPrefs((v) => ({
                              ...v,
                              remoteBitrate:
                                v.remoteBitrate === "320k"
                                  ? "original"
                                  : "320k",
                            }))
                          : togglePlayerPref(key)
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="setting-actions">
              <button className="primary small" onClick={savePlayerPrefs}>
                <Check />
                保存播放器偏好
              </button>
              <button
                className="secondary small"
                onClick={() => navigate?.("player")}
              >
                <Play />
                打开播放器验证
              </button>
            </div>
          </SettingBlock>
        )}
        {tab === "user" && (
          <div className="settings-grid">
            <SettingBlock
              icon={UserRound}
              title="用户偏好"
              note="头像、主题、默认音乐源与默认音质。"
            >
              <div className="profile-card">
                <div className="profile-avatar">
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" />
                  ) : (
                    <UserRound />
                  )}
                </div>
                <div>
                  <strong>
                    {profile?.displayName || settings.user?.username || "admin"}
                  </strong>
                  <span>@{settings.user?.username || "admin"}</span>
                  <label className="secondary small avatar-upload">
                    <Image />
                    更换头像
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={uploadAvatar}
                    />
                  </label>
                </div>
              </div>
              <div className="profile-form">
                <label>
                  显示名称
                  <input
                    value={profile?.displayName || ""}
                    onChange={(e) =>
                      setProfile((v) => ({ ...v, displayName: e.target.value }))
                    }
                  />
                </label>
                <label>
                  默认音源
                  <select
                    value={profile?.defaultSource || "tx"}
                    onChange={(e) =>
                      setProfile((v) => ({
                        ...v,
                        defaultSource: e.target.value,
                      }))
                    }
                  >
                    <option value="tx">QQ 音乐</option>
                    <option value="wy">网易云</option>
                  </select>
                </label>
                <label>
                  默认音质
                  <select
                    value={profile?.defaultQuality || "320k"}
                    onChange={(e) =>
                      setProfile((v) => ({
                        ...v,
                        defaultQuality: e.target.value,
                      }))
                    }
                  >
                    <option value="128k">128K</option>
                    <option value="320k">320K</option>
                    <option value="flac">FLAC</option>
                    <option value="flac24bit">Hi-Res</option>
                  </select>
                </label>
                <label>
                  界面字号
                  <select
                    value={profile?.fontSize || "standard"}
                    onChange={(e) =>
                      setProfile((value) => ({
                        ...value,
                        fontSize: e.target.value,
                      }))
                    }
                  >
                    <option value="compact">紧凑</option>
                    <option value="standard">标准</option>
                    <option value="large">大号</option>
                  </select>
                </label>
                <button
                  className="secondary small"
                  onClick={() => saveProfile(profile)}
                >
                  <Check />
                  保存偏好
                </button>
              </div>
            </SettingBlock>
            <section className="setting-card">
              <div className="setting-title">
                <KeyRound />
                <div>
                  <h3>修改密码</h3>
                  <p>更换音屿 Web 控制台密码。</p>
                </div>
              </div>
              <form className="password-form" onSubmit={change}>
                <label>
                  当前密码
                  <input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
                <label>
                  新密码
                  <input
                    type="password"
                    minLength="10"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="至少 10 个字符"
                  />
                </label>
                {message && <p className="form-message">{message}</p>}
                <button className="secondary">
                  <ShieldCheck />
                  更新密码
                </button>
              </form>
            </section>
          </div>
        )}
        {tab === "logs" && (
          <>
            <SettingBlock
              icon={ShieldCheck}
              title="备份与恢复"
              note="备份账号、设置、任务、索引和操作记录；音乐文件不会复制。"
            >
              <div className="backup-toolbar">
                <button
                  className="primary small"
                  disabled={!!backupBusy}
                  onClick={createBackup}
                >
                  {backupBusy === "create" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Plus />
                  )}
                  创建备份
                </button>
                <span>备份保存在 NAS 的 /data/backups</span>
              </div>
              <div className="backup-list">
                {backups.length ? (
                  backups.map((item) => (
                    <div key={item.name}>
                      <ShieldCheck />
                      <div>
                        <strong>{item.name}</strong>
                        <span>
                          {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {(item.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      <a
                        className="secondary small"
                        href={`/api/backups/${encodeURIComponent(item.name)}/download`}
                      >
                        <Download />
                        导出
                      </a>
                      <button
                        className="secondary small"
                        disabled={!!backupBusy}
                        onClick={() => restoreBackup(item)}
                      >
                        {backupBusy === item.name ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <RotateCcw />
                        )}
                        恢复
                      </button>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={ShieldCheck}
                    title="还没有备份"
                    text="创建首个备份后，可在这里导出或恢复。"
                  />
                )}
              </div>
            </SettingBlock>
            <SettingBlock
              icon={ScrollText}
              title="运行日志"
              note="操作日志、任务日志、音乐源日志与回滚记录集中查看。"
            >
              <div className="log-toolbar">
                <button
                  className="secondary small"
                  disabled={logsLoading}
                  onClick={loadLogs}
                >
                  {logsLoading ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  刷新日志
                </button>
                <span>
                  {logs?.updatedAt
                    ? `更新于 ${new Date(logs.updatedAt).toLocaleString("zh-CN")}`
                    : "点击刷新读取日志"}
                </span>
              </div>
              {logsLoading ? (
                <PageLoader />
              ) : (
                <div className="settings-log-grid">
                  <div>
                    <h3>任务日志</h3>
                    {(logs?.jobLogs || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.level}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>
                          {item.job_title || item.job_kind || "任务"}
                        </strong>
                        <span>{item.message}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>音乐源日志</h3>
                    {(logs?.sourceLogs || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.level}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>{item.source_name || item.action}</strong>
                        <span>{item.message}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>操作与回滚</h3>
                    {(logs?.operations || []).slice(0, 30).map((item) => (
                      <div className={`log-line ${item.status}`} key={item.id}>
                        <time>
                          {new Date(item.created_at).toLocaleString("zh-CN")}
                        </time>
                        <strong>{item.action}</strong>
                        <span>
                          {item.target_id || item.error_message || "已记录"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SettingBlock>
          </>
        )}
        {isAdmin && tab === "user" && <UserAccounts />}
      </section>
      {isAdmin && plexOpen && (
        <PlexSettingsModal
          initial={plex}
          onClose={() => setPlexOpen(false)}
          onSaved={async (next) => {
            setPlex(next);
            setPlexOpen(false);
            setMessage("Plex 配置已保存");
          }}
        />
      )}
    </div>
  );
}

function PlexSettingsModal({ initial, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    enabled: initial.enabled ?? true,
    name: initial.name || "Plex",
    serverUrl: initial.serverUrl || "",
    externalUrl: initial.externalUrl || "",
    token: "",
    selectedLibraryKeys: initial.selectedLibraryKeys || "all",
  });
  const [libraries, setLibraries] = useState(initial.libraries || []),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [showToken, setShowToken] = useState(false);
  const selectedAll = draft.selectedLibraryKeys === "all";
  const selectedKeys = Array.isArray(draft.selectedLibraryKeys)
    ? draft.selectedLibraryKeys
    : [];
  const validateBaseUrl = (value, label, required = true) => {
    const raw = (value || "").trim();
    if (!raw && !required) return "";
    if (!raw) throw new Error(`${label}不能为空`);
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`${label}必须是 http 或 https 地址`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host)
      throw new Error(`${label}必须是 http 或 https 地址`);
    if (
      (parsed.pathname && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(`${label}只能填写根地址，不能带路径、参数或片段`);
    return raw.replace(/\/+$/, "");
  };
  const setField = (key, value) => setDraft((v) => ({ ...v, [key]: value }));
  const refreshLibraries = async () => {
    setBusy("libraries");
    setMessage("");
    try {
      const data = await api("/api/plex/libraries");
      setLibraries(data.items || []);
      setMessage(`已读取 ${data.items?.length || 0} 个音乐库`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    setBusy("test");
    setMessage("");
    try {
      const serverUrl = validateBaseUrl(draft.serverUrl, "服务器内网地址");
      const result = await api("/api/plex/test", {
        method: "POST",
        body: JSON.stringify({ serverUrl, token: draft.token }),
      });
      setLibraries(result.libraries || []);
      setMessage(result.message || "Plex 连接成功");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setMessage("");
    try {
      const safe = {
        ...draft,
        serverUrl: validateBaseUrl(draft.serverUrl, "服务器内网地址"),
        externalUrl: validateBaseUrl(draft.externalUrl, "外网播放地址", false),
      };
      const result = await api("/api/settings/plex", {
        method: "POST",
        body: JSON.stringify(safe),
      });
      onSaved(result.settings);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const toggleLibrary = (key) =>
    setDraft((v) => {
      const keys = Array.isArray(v.selectedLibraryKeys)
        ? v.selectedLibraryKeys
        : [];
      return {
        ...v,
        selectedLibraryKeys: keys.includes(key)
          ? keys.filter((item) => item !== key)
          : [...keys, key],
      };
    });
  return (
    <div className="modal-wrap">
      <button className="modal-backdrop" onClick={onClose} />
      <section className="modal panel plex-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              <Server />
              PLEX MEDIA SERVER
            </span>
            <h3>配置 Plex 媒体服务器</h3>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="plex-form">
          <label className="switch-line">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setField("enabled", e.target.checked)}
            />
            <span>启用 Plex 联动与媒体库同步</span>
          </label>
          <div className="plex-grid">
            <label>
              显示名称
              <input
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="例如：极空间 Plex"
              />
            </label>
            <label>
              服务器内网地址
              <input
                value={draft.serverUrl}
                onChange={(e) => setField("serverUrl", e.target.value)}
                placeholder="http://nas-address:32400"
              />
            </label>
            <label>
              外网播放地址（可选）
              <input
                value={draft.externalUrl}
                onChange={(e) => setField("externalUrl", e.target.value)}
                placeholder="https://plex.example.com"
              />
            </label>
            <label>
              X-Plex-Token
              <div className="token-row">
                <input
                  type={showToken ? "text" : "password"}
                  value={draft.token}
                  onChange={(e) => setField("token", e.target.value)}
                  placeholder={
                    initial.hasToken
                      ? "留空则继续使用已保存 Token"
                      : "输入 X-Plex-Token"
                  }
                />
                <button type="button" onClick={() => setShowToken((v) => !v)}>
                  {showToken ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
          </div>
          <div className="library-mode">
            <button
              type="button"
              className={selectedAll ? "active" : ""}
              onClick={() => setField("selectedLibraryKeys", "all")}
            >
              <Library />
              同步全部音乐库
            </button>
            <button
              type="button"
              className={!selectedAll ? "active" : ""}
              onClick={() =>
                setField(
                  "selectedLibraryKeys",
                  selectedKeys.length ? selectedKeys : [],
                )
              }
            >
              <ListMusic />
              仅同步指定音乐库
            </button>
          </div>
          <div className="library-tools">
            <button
              className="secondary small"
              disabled={!!busy}
              onClick={test}
            >
              {busy === "test" ? (
                <LoaderCircle className="spin" />
              ) : (
                <TestTube2 />
              )}
              测试连接
            </button>
            <button
              className="secondary small"
              disabled={!!busy}
              onClick={refreshLibraries}
            >
              {busy === "libraries" ? (
                <LoaderCircle className="spin" />
              ) : (
                <RefreshCw />
              )}
              刷新媒体库
            </button>
          </div>
          <div className="library-list">
            {libraries.length ? (
              libraries.map((item) => (
                <label
                  key={item.key}
                  className={`library-row ${item.enabled ? "active" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={selectedAll}
                    checked={selectedAll || selectedKeys.includes(item.key)}
                    onChange={() => toggleLibrary(item.key)}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.type || "music"} · #{item.key}
                    </span>
                  </div>
                  <i>{item.enabled ? "已同步" : "未选中"}</i>
                </label>
              ))
            ) : (
              <Empty
                icon={Library}
                title="还没有媒体库列表"
                text="先测试连接或刷新媒体库，音屿会只展示 Plex 音乐资料库。"
              />
            )}
          </div>
          {message && (
            <div className="inline-info">
              <ShieldCheck />
              {message}
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={!!busy} onClick={save}>
              {busy === "save" ? <LoaderCircle className="spin" /> : <Check />}
              确认保存
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function UserAccounts() {
  const [items, setItems] = useState([]),
    [form, setForm] = useState({
      username: "",
      displayName: "",
      password: "",
      role: "listener",
      permissions: ["listen"],
      libraryScopes: [],
    }),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const [resetting, setResetting] = useState(null),
    [resetPassword, setResetPassword] = useState("");
  const strength = (password) => {
    let score = 0;
    if ((password || "").length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return ["太弱", "偏弱", "可用", "较强", "很强"][score];
  };
  const load = async () => {
    try {
      const data = await api("/api/users");
      setItems(data.items || []);
    } catch (err) {
      setMessage(err.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const create = async (event) => {
    event.preventDefault();
    if (strength(form.password) === "太弱")
      return setMessage("密码至少 10 位，建议包含大小写、数字和符号。");
    setBusy("create");
    setMessage("");
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({
        username: "",
        displayName: "",
        password: "",
        role: "listener",
        permissions: ["listen"],
        libraryScopes: [],
      });
      setMessage("账号已创建");
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const toggle = async (item) => {
    if (!confirm(`${item.enabled ? "停用" : "启用"}账号 ${item.username}？`))
      return;
    setBusy(item.id);
    setMessage("");
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const rename = async (item) => {
    const username = prompt(
      "新的用户名（admin 内置账号不可改名）",
      item.username,
    );
    if (!username) return;
    const displayName =
      prompt("显示名称", item.displayName || username) || username;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ username, displayName }),
      });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const editAccess = async (item) => {
    const permissions = prompt(
      "操作权限（逗号分隔：listen, manage_library, manage_sources, view_logs, manage_users）",
      (item.permissions || []).join(", "),
    );
    if (permissions === null) return;
    const scopes = prompt(
      "可访问目录（相对 /music，逗号分隔；* 表示全部）",
      (item.libraryScopes || []).join(", "),
    );
    if (scopes === null) return;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          permissions: permissions
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          libraryScopes: scopes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      setMessage("权限范围已更新");
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const submitReset = async (event) => {
    event.preventDefault();
    if (!resetting) return;
    if (strength(resetPassword) === "太弱")
      return setMessage("新密码至少 10 位，建议包含大小写、数字和符号。");
    if (
      !confirm(
        `确认重置 ${resetting.username} 的密码？该账号需要使用新密码重新登录。`,
      )
    )
      return;
    setBusy(resetting.id);
    try {
      await api(`/api/users/${resetting.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setMessage(`已重置 ${resetting.username} 的密码`);
      setResetting(null);
      setResetPassword("");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  const remove = async (item) => {
    if (
      !confirm(
        `删除账号 ${item.username}？\n\n此操作会移除登录能力，但不会删除音乐文件。`,
      )
    )
      return;
    setBusy(item.id);
    try {
      await api(`/api/users/${item.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="panel account-panel">
      <SectionHead
        title="账户与多用户"
        note="普通用户只看到播放、收藏、发现和个人页；管理员才显示管理中心。"
        action={
          <button className="secondary small" onClick={load}>
            <RefreshCw />
            刷新
          </button>
        }
      />
      {message && (
        <div className="inline-info">
          <ShieldCheck />
          {message}
        </div>
      )}
      <div className="account-list">
        {items.map((item) => (
          <div className="account-row" key={item.id}>
            <UserRound />
            <div>
              <strong>{item.displayName || item.username}</strong>
              <span>
                @{item.username} · {item.role || "listener"} ·{" "}
                {item.enabled ? "已启用" : "已停用"} ·{" "}
                {item.lastLoginAt
                  ? `上次登录 ${timeAgo(item.lastLoginAt)}`
                  : "未登录"}
                <br />
                权限：{(item.permissions || []).join("、")} · 目录：
                {(item.libraryScopes || []).join("、") || "未授权"}
              </span>
            </div>
            <div className="account-row-actions">
              <button className="secondary small" onClick={() => rename(item)}>
                改名
              </button>
              <button
                className="secondary small"
                onClick={() => editAccess(item)}
              >
                权限范围
              </button>
              <button
                className="secondary small"
                onClick={() => setResetting(item)}
              >
                重置密码
              </button>
              <button
                className="secondary small"
                disabled={busy === item.id}
                onClick={() => toggle(item)}
              >
                {item.enabled ? "停用" : "启用"}
              </button>
              <button className="icon-button danger" onClick={() => remove(item)}>
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
      <form className="account-create" onSubmit={create}>
        <label>
          用户名
          <input
            value={form.username}
            onChange={(e) =>
              setForm((v) => ({ ...v, username: e.target.value }))
            }
            placeholder="例如 playsong"
          />
        </label>
        <label>
          显示名称
          <input
            value={form.displayName}
            onChange={(e) =>
              setForm((v) => ({ ...v, displayName: e.target.value }))
            }
            placeholder="例如 PlaySong"
          />
        </label>
        <label>
          角色
          <select
            value={form.role}
            onChange={(e) => {
              const role = e.target.value;
              setForm((v) => ({
                ...v,
                role,
                permissions:
                  role === "listener"
                    ? ["listen"]
                    : role === "library_admin"
                      ? [
                          "listen",
                          "manage_library",
                          "manage_sources",
                          "view_logs",
                        ]
                      : [
                          "listen",
                          "manage_library",
                          "manage_sources",
                          "manage_users",
                          "view_logs",
                        ],
                libraryScopes: role === "listener" ? [] : ["*"],
              }));
            }}
          >
            <option value="listener">普通用户</option>
            <option value="library_admin">曲库管理员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <label className="account-scope">
          可访问目录
          <input
            value={(form.libraryScopes || []).join(", ")}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                libraryScopes: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="例如：周杰伦, 五月天；* 表示全部"
          />
          <small>按 /music 下的相对目录限制本地文件访问。</small>
        </label>
        <div className="account-permissions">
          {[
            ["listen", "播放"],
            ["manage_library", "曲库管理"],
            ["manage_sources", "音乐源"],
            ["view_logs", "日志/备份"],
            ["manage_users", "用户管理"],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={(form.permissions || []).includes(key)}
                disabled={key === "listen"}
                onChange={() =>
                  setForm((value) => ({
                    ...value,
                    permissions: value.permissions.includes(key)
                      ? value.permissions.filter((item) => item !== key)
                      : [...value.permissions, key],
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <label>
          初始密码
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) =>
              setForm((v) => ({ ...v, password: e.target.value }))
            }
            placeholder="至少 10 位"
          />
          <small>强度：{strength(form.password)}</small>
        </label>
        <button className="primary small" disabled={busy === "create"}>
          {busy === "create" ? <LoaderCircle className="spin" /> : <Plus />}
          新建用户
        </button>
      </form>
      <p className="setting-copy">
        忘记主人账号密码时，请由设备管理员按照部署文档中的“恢复管理员访问”
        流程操作；恢复会使现有会话失效。
      </p>
      {resetting && (
        <div className="modal-wrap">
          <button
            className="modal-backdrop"
            onClick={() => setResetting(null)}
          />
          <form
            className="modal panel password-reset-modal"
            onSubmit={submitReset}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">RESET PASSWORD</span>
                <h3>重置 {resetting.username} 的密码</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setResetting(null)}
              >
                <X />
              </button>
            </div>
            <label>
              新密码
              <input
                autoFocus
                type="password"
                autoComplete="new-password"
                minLength="10"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="至少 10 位"
              />
              <small>强度：{strength(resetPassword)}</small>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setResetting(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy === resetting.id}>
                {busy === resetting.id ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <ShieldCheck />
                )}
                确认重置
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function SettingBlock({ icon: Icon, title, note, children }) {
  return (
    <section className="setting-card">
      <div className="setting-title">
        <Icon />
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PageLoader() {
  return (
    <div className="page-loader">
      <LoaderCircle className="spin" />
      <span>正在读取音乐库…</span>
    </div>
  );
}

function Toast({ toast, clear }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 3200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type || "ok"}`}>
      {toast.type === "error" ? <CircleAlert /> : <Check />}
      <span>{toast.message}</span>
      <button onClick={clear}>
        <X />
      </button>
    </div>
  );
}

function GlobalSearchPage({ play, navigate, isAdmin }) {
  const player = usePlayer();
  const [query, setQuery] = useState(
      () => localStorage.getItem("songlib-global-search") || "",
    ),
    [loading, setLoading] = useState(false),
    [groups, setGroups] = useState({
      tracks: [],
      artists: [],
      albums: [],
      pending: [],
    }),
    [error, setError] = useState("");
  const search = async (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) return;
    localStorage.setItem("songlib-global-search", text);
    setLoading(true);
    setError("");
    try {
      const [tracks, artists, albums, pending] = await Promise.all([
        api(
          `/api/catalog/unified?limit=40&q=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        api(
          `/api/library/artists?pageSize=12&search=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        api(
          `/api/library/albums?pageSize=12&search=${encodeURIComponent(text)}`,
        ).catch(() => ({ items: [] })),
        isAdmin
          ? api("/api/downloads/pending").catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      setGroups({
        tracks: tracks.items || [],
        artists: artists.items || [],
        albums: albums.items || [],
        pending: (pending.items || []).filter((item) =>
          JSON.stringify(item).includes(text),
        ),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (query) search();
  }, []);
  const groupTotal = Object.values(groups).reduce(
    (sum, items) => sum + (items?.length || 0),
    0,
  );
  const TrackActions = ({ item }) => (
    <div className="search-row-actions">
      <button title="播放" onClick={() => play(item)}>
        <Play />
      </button>
      <button title="下一首" onClick={() => player.addToQueue(item)}>
        <ListMusic />
      </button>
      <button title="收藏" onClick={() => player.toggleFavorite(item)}>
        <Heart />
      </button>
      {isAdmin && (
        <button
          title="编辑/定位"
          onClick={() =>
            navigate(
              item.sourceTypes?.includes("local_file") ? "local" : "library",
            )
          }
        >
          <Tags />
        </button>
      )}
    </div>
  );
  return (
    <div className="page global-search-page">
      <section className="page-intro">
        <span className="eyebrow">
          <Search />
          GLOBAL SEARCH
        </span>
        <h1>全局搜索</h1>
        <p>同一首歌只显示一次，本地文件与 Plex 作为可切换资源附在歌曲下。</p>
      </section>
      <form className="catalog-search" onSubmit={search}>
        <div className="big-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲、艺术家、专辑、文件名…"
          />
          <button className="primary" disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : "搜索"}
          </button>
        </div>
      </form>
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {loading ? (
        <PageLoader />
      ) : (
        <div className="search-groups">
          {!groupTotal && query ? (
            <Empty
              icon={Search}
              title="没有找到匹配内容"
              text="换个关键词，或先扫描本地曲库/同步 Plex。"
            />
          ) : null}
          <section className="panel">
            <SectionHead
              title="单曲"
              note={`${groups.tracks.length} 首标准歌曲实体`}
            />
            {groups.tracks.map((item) => (
              <div className="search-result-row" key={item.id}>
                <Music2 />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                    <em className={`match-badge ${item.matchStatus}`}>
                      {item.sourceSummary}
                    </em>
                  </span>
                </div>
                <TrackActions item={item} />
              </div>
            ))}
          </section>
          <section className="panel">
            <SectionHead
              title="艺人 / 专辑"
              note={`${groups.artists.length} 位艺人 · ${groups.albums.length} 张专辑`}
            />
            <div className="search-card-grid">
              {[
                ...groups.artists.map((item) => ({ ...item, type: "artists" })),
                ...groups.albums.map((item) => ({ ...item, type: "albums" })),
              ].map((item) => (
                <button
                  key={`${item.type}-${item.ratingKey}`}
                  onClick={() => {
                    navigate("library");
                    localStorage.setItem("songlib-global-search", item.title);
                  }}
                >
                  <div>
                    {item.thumbUrl ? (
                      <img src={item.thumbUrl} alt="" />
                    ) : (
                      <Album />
                    )}
                  </div>
                  <strong>{item.title}</strong>
                  <span>{item.type === "artists" ? "艺人" : "专辑"}</span>
                </button>
              ))}
            </div>
          </section>
          {isAdmin && (
            <section className="panel">
              <SectionHead
                title="待修复 / 待入库"
                note={`${groups.pending.length} 个下载候选`}
              />
              {groups.pending.map((item) => (
                <div className="search-result-row" key={item.jobId}>
                  <Download />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.downloadPath || "待确认路径"}</span>
                  </div>
                  <button
                    className="secondary small"
                    onClick={() => navigate("download")}
                  >
                    去处理
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MePage({ navigate }) {
  const player = usePlayer();
  const favorites = Object.values(player.favorites || {}).sort((a, b) =>
    String(b.likedAt || "").localeCompare(String(a.likedAt || "")),
  );
  const history = player.history || [];
  const events = player.playEvents || history;
  const playlists = player.playlists || {};
  const newPlaylist = () => {
    const name = prompt("新建歌单名称");
    if (name) player.createPlaylist(name);
  };
  const totalMinutes = Math.round(
    events.reduce((sum, item) => sum + Number(item.duration || 0), 0) / 60,
  );
  const artistCounts = events.reduce((map, item) => {
    const key = item.artist || "未知歌手";
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const recentDays = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: events.filter((item) => {
        const value = new Date(item.playedAt).getTime();
        return value >= date.getTime() && value < next.getTime();
      }).length,
    };
  });
  const maxDay = Math.max(1, ...recentDays.map((item) => item.count));
  return (
    <div className="page me-page refined-me-page">
      <section className="page-intro">
        <span className="eyebrow">
          <UserRound />
          MY MUSIC
        </span>
        <h1>我的音乐</h1>
        <p>收藏、回听与个人歌单，按你的聆听习惯自然汇集。</p>
      </section>
      <div className="me-dashboard">
        <section className="me-listening-surface">
          <header className="me-section-head">
            <div>
              <span>本地聆听报告</span>
              <h2>最近的音乐足迹</h2>
            </div>
            <small>仅根据本机记录生成</small>
          </header>
          <div className="me-metric-strip">
            {[
              [Play, "播放", events.length, "次"],
              [Clock3, "时长", totalMinutes, "分钟"],
              [Heart, "收藏", favorites.length, "首"],
            ].map(([Icon, label, value, unit]) => (
              <div className="me-metric" key={label}>
                <span><Icon /></span>
                <div>
                  <small>{label}</small>
                  <strong>{fmt(value)} <em>{unit}</em></strong>
                </div>
              </div>
            ))}
          </div>
          <div className="me-insights">
            <div className="me-weekly">
              <h3>近 7 天</h3>
              <div className="listening-bars">
                {recentDays.map((item) => (
                  <span key={item.label}>
                    <i
                      style={{
                        height: `${Math.max(4, (item.count / maxDay) * 100)}%`,
                      }}
                    />
                    <b>{item.count}</b>
                    <small>{item.label}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="me-artists">
              <h3>常听音乐人</h3>
              {topArtists.length ? (
                <ol>
                  {topArtists.map(([name, count], index) => (
                    <li key={name}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>{name}</span>
                      <em>{count} 次</em>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>播放几首歌曲后，这里会出现你的常听音乐人。</p>
              )}
            </div>
          </div>
        </section>
        <section className="me-collection-surface">
          <header className="me-section-head">
            <div>
              <span>收藏</span>
              <h2>我喜欢</h2>
            </div>
            <small>{favorites.length} 首</small>
          </header>
          {favorites.length ? (
            <div className="favorite-list me-track-list">
              {favorites.slice(0, 8).map((item) => (
                <button
                  key={trackIdentity(item)}
                  onClick={() => player.play(item)}
                >
                  <Heart />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist || "未知歌手"} · {item.album || "未知专辑"}
                    </span>
                  </div>
                  <Play />
                </button>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><Heart /></span>
              <div>
                <strong>还没有收藏</strong>
                <p>播放歌曲时点亮喜欢，它就会留在这里。</p>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="me-lower-grid">
        <section className="me-list-surface">
          <header className="me-section-head">
            <div>
              <span>继续聆听</span>
              <h2>最近播放</h2>
            </div>
            <small>{history.length} 条</small>
          </header>
          {history.length ? (
            <div className="favorite-list me-track-list">
              {history.slice(0, 10).map((item) => (
                <button
                  key={`${trackIdentity(item)}-${item.playedAt}`}
                  onClick={() => player.play(item)}
                >
                  <Clock3 />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.artist || "未知歌手"} · {timeAgo(item.playedAt)}
                    </span>
                  </div>
                  <Play />
                </button>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><Play /></span>
              <div>
                <strong>暂无播放记录</strong>
                <p>从音乐库开始播放，最近听过的内容会保留在这里。</p>
              </div>
            </div>
          )}
        </section>
        <section className="me-list-surface">
          <header className="me-section-head">
            <div>
              <span>我的收藏夹</span>
              <h2>歌单</h2>
            </div>
            <button className="secondary small" onClick={newPlaylist}>
              <Plus />
              新建歌单
            </button>
          </header>
          {Object.keys(playlists).length ? (
            <div className="playlist-library me-playlist-list">
              {Object.entries(playlists).map(([name, tracks]) => (
                <article key={name}>
                  <button
                    onClick={() =>
                      tracks[0] && player.play(tracks[0], tracks.slice(1))
                    }
                  >
                    <ListMusic />
                    <div>
                      <strong>{name}</strong>
                      <span>{tracks.length} 首歌曲</span>
                    </div>
                    <Play />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() =>
                      confirm(`删除歌单“${name}”？歌曲文件不会被删除。`) &&
                      player.deletePlaylist(name)
                    }
                    aria-label={`删除歌单 ${name}`}
                  >
                    <Trash2 />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="me-empty-inline">
              <span><ListMusic /></span>
              <div>
                <strong>还没有歌单</strong>
                <p>新建歌单，把想反复听的歌曲放在一起。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PlaylistsPage({
  play,
  notify,
  initialPlaylistId = "",
  onPlaylistChange,
}) {
  const [items, setItems] = useState([]);
  const [servicePlaylists, setServicePlaylists] = useState({
    plex: { configured: false, items: [], error: null },
    fnos: { configured: false, items: [], error: null },
  });
  const [serviceBusy, setServiceBusy] = useState(false);
  const [servicePlaying, setServicePlaying] = useState("");
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [migration, setMigration] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState("");
  const [migrationTargets, setMigrationTargets] = useState(["songlib"]);
  const [downloadMissing, setDownloadMissing] = useState(false);
  const [migrationSource, setMigrationSource] = useState("");
  const [migrationQuality, setMigrationQuality] = useState("320k");
  const fileRef = useRef(null);
  const loadServices = async () => {
    setServiceBusy(true);
    try {
      const connected = await api("/api/playlists/services");
      setServicePlaylists(connected);
    } catch (err) {
      setServicePlaylists({
        plex: { configured: false, items: [], error: err.message },
        fnos: { configured: false, items: [], error: err.message },
      });
    } finally {
      setServiceBusy(false);
    }
  };
  const load = async (preferredId, { replace = false } = {}) => {
    const [data] = await Promise.all([
      api("/api/playlists"),
      loadServices(),
    ]);
    setItems(data.items || []);
    const id = preferredId || selected?.id || data.items?.[0]?.id;
    if (id) {
      const detail = await api(`/api/playlists/${id}`);
      setSelected(detail);
      onPlaylistChange?.(id, { replace });
    } else {
      setSelected(null);
      onPlaylistChange?.("", { replace: true });
    }
  };
  useEffect(() => {
    load(initialPlaylistId, { replace: !initialPlaylistId }).catch((err) =>
      setError(err.message),
    );
  }, []);
  const create = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await api("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), description: "", items: [] }),
      });
      setNewName("");
      await load(created.id);
      notify("歌单已创建");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/playlists/import/m3u", {
        method: "POST",
        body: JSON.stringify({
          name: file.name.replace(/\.(m3u8?|txt)$/i, ""),
          content: await file.text(),
          pathMappings: [],
        }),
      });
      await load(result.playlist.id);
      notify(`已导入 ${result.matched} 首，${result.unmatched.length} 首需要匹配`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`删除歌单“${selected.name}”？歌曲文件不会被删除。`)) return;
    setBusy(true);
    try {
      await api(`/api/playlists/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      await load();
      notify("歌单已删除");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const move = async (index, delta) => {
    const next = [...selected.items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const updated = await api(`/api/playlists/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: next.map(playlistTrackPayload),
        }),
      });
      setSelected(updated);
      await load(updated.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const playable = playlistPlaybackInput;
  const playAll = () => {
    const queue = (selected?.items || []).map(playable).filter(Boolean);
    if (queue.length) play(queue[0], queue.slice(1));
  };
  const playSelectedFrom = (index) => {
    const queue = (selected?.items || [])
      .slice(index)
      .map(playable)
      .filter(Boolean);
    if (queue.length) play(queue[0], queue.slice(1));
  };
  const playServicePlaylist = async (serviceId, item) => {
    if (serviceId !== "plex") {
      setError("飞牛音乐歌单播放需要服务返回可播放曲目；当前连接可用于歌单同步。");
      return;
    }
    const busyKey = `${serviceId}:${item.id}`;
    setServicePlaying(busyKey);
    setError("");
    try {
      const detail = await api(
        `/api/playlists/services/${serviceId}/${encodeURIComponent(item.id)}`,
      );
      const queue = servicePlaylistPlaybackItems(serviceId, detail.items);
      if (!queue.length) throw new Error("这个歌单里没有可播放曲目");
      await play(queue[0], queue.slice(1));
      notify(`正在播放“${item.name}”，共 ${queue.length} 首`);
    } catch (err) {
      setError(err.message);
    } finally {
      setServicePlaying("");
    }
  };
  const syncSelected = async (target) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/playlists/${selected.id}/sync`, {
        method: "POST",
        body: JSON.stringify({ targets: [target] }),
      });
      const synced = result[target];
      if (synced?.ok === false) throw new Error(synced.error || "同步失败");
      notify(
        target === "plex"
          ? `已同步到 Plex，共 ${synced?.itemCount || 0} 首`
          : `已同步到飞牛音乐，共 ${synced?.matched || 0} 首`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const previewMigration = async (event) => {
    event.preventDefault();
    if (!shareUrl.trim()) return;
    setMigrationBusy("preview");
    setError("");
    try {
      const result = await api("/api/playlists/migrate/preview", {
        method: "POST",
        body: JSON.stringify({ shareUrl: shareUrl.trim() }),
      });
      setMigration(result);
      setMigrationTargets(["songlib"]);
      setDownloadMissing(false);
      setMigrationSource(result.downloadSources?.[0]?.id || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setMigrationBusy("");
    }
  };
  const toggleMigrationTarget = (target) => {
    setMigrationTargets((value) =>
      value.includes(target)
        ? value.filter((item) => item !== target)
        : [...value, target],
    );
  };
  const executeMigration = async () => {
    if (!migrationTargets.length) {
      setError("请至少选择一个迁移目标");
      return;
    }
    setMigrationBusy("execute");
    setError("");
    try {
      const result = await api("/api/playlists/migrate/execute", {
        method: "POST",
        body: JSON.stringify({
          sourceUrl: migration.sourceUrl,
          targets: migrationTargets,
          downloadMissing,
          sourceId: downloadMissing ? migrationSource : null,
          quality: migrationQuality,
        }),
      });
      if (result.songlib?.id) await load(result.songlib.id);
      const details = [
        result.songlib ? `音屿 ${result.songlib.itemCount} 首` : "",
        result.plex?.ratingKey ? `Plex ${result.plex.itemCount} 首` : "",
        result.fnos?.ok ? `飞牛音乐 ${result.fnos.matched} 首` : "",
        result.downloads?.created ? `${result.downloads.created} 首进入下载队列` : "",
      ].filter(Boolean);
      notify(details.length ? `迁移完成：${details.join("，")}` : "迁移任务已处理");
      setMigration(null);
      setShareUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setMigrationBusy("");
    }
  };
  return (
    <div className="page playlists-page">
      <section className="page-intro playlist-intro">
        <div>
          <span className="eyebrow"><ListMusic />我的歌单</span>
          <h1>把喜欢的歌带回来</h1>
          <p>创建歌单，导入文件，或从常用音乐平台迁移。</p>
        </div>
        <div className="playlist-actions">
          <button className="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp />导入 M3U
          </button>
          <input ref={fileRef} hidden type="file" accept=".m3u,.m3u8,audio/x-mpegurl" onChange={importFile} />
          {selected && (
            <a className="secondary button-link" href={`/api/playlists/${selected.id}/export.m3u`}>
              <Download />导出
            </a>
          )}
        </div>
      </section>
      <section className="playlist-migration panel">
        <div className="migration-heading">
          <span><Link2 /></span>
          <div>
            <strong>从分享链接迁移</strong>
            <small>支持 QQ 音乐、网易云音乐公开歌单</small>
          </div>
        </div>
        <form onSubmit={previewMigration}>
          <input
            type="url"
            value={shareUrl}
            onChange={(event) => setShareUrl(event.target.value)}
            placeholder="粘贴歌单分享链接"
          />
          <button className="primary" disabled={!shareUrl.trim() || migrationBusy === "preview"}>
            {migrationBusy === "preview" ? <LoaderCircle className="spin" /> : <Search />}
            读取歌单
          </button>
        </form>
        <p className="migration-privacy">只读取公开歌单信息，不需要第三方账号密码。</p>
      </section>
      {migration && (
        <section className="migration-preview panel">
          <header>
            <div className="migration-cover">
              {migration.coverUrl ? <img src={migration.coverUrl} alt="" /> : <ListMusic />}
            </div>
            <div>
              <span>{migration.platformLabel}</span>
              <h2>{migration.name}</h2>
              <p>
                {migration.summary.total} 首 · {migration.summary.matched} 首已匹配 ·{" "}
                {migration.summary.missing} 首待补全
              </p>
            </div>
            <button className="icon-button" onClick={() => setMigration(null)} aria-label="关闭迁移预览"><X /></button>
          </header>
          <div className="migration-targets">
            {[
              ["songlib", "音屿歌单", Music2],
              ["plex", "Plex", Server],
              ["fnos", "飞牛音乐", Radio],
            ].map(([id, label, Icon]) => {
              const available = migration.targets?.[id]?.available !== false;
              const selectedTarget = migrationTargets.includes(id);
              return (
                <button
                  key={id}
                  className={selectedTarget ? "active" : ""}
                  disabled={!available}
                  onClick={() => toggleMigrationTarget(id)}
                >
                  <Icon />
                  <span><strong>{label}</strong><small>{available ? (selectedTarget ? "已选择" : "可迁移") : "需要先配置连接"}</small></span>
                  <i>{selectedTarget ? <Check /> : <Plus />}</i>
                </button>
              );
            })}
          </div>
          {migration.summary.missing > 0 && (
            <div className="migration-download-option">
              <label>
                <input
                  type="checkbox"
                  checked={downloadMissing}
                  disabled={!migration.downloadSources?.length}
                  onChange={(event) => setDownloadMissing(event.target.checked)}
                />
                <span><strong>补全缺失歌曲</strong><small>只采用标题、主要艺人和时长全部通过校验的版本</small></span>
              </label>
              {downloadMissing && (
                <div>
                  <select value={migrationSource} onChange={(event) => setMigrationSource(event.target.value)}>
                    {(migration.downloadSources || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <select value={migrationQuality} onChange={(event) => setMigrationQuality(event.target.value)}>
                    <option value="flac">优先无损</option>
                    <option value="320k">高品质 320K</option>
                    <option value="128k">标准 128K</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="migration-track-preview">
            {(migration.tracks || []).slice(0, 12).map((item, index) => (
              <div key={`${item.externalRef}-${index}`} className={item.matchStatus === "matched" ? "matched" : "missing"}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.title}</strong><small>{item.artist || "未知艺人"} · {item.album || "未知专辑"}</small></div>
                <em>{item.matchStatus === "matched" ? "已匹配" : "待补全"}</em>
              </div>
            ))}
            {migration.summary.total > 12 && <p>另有 {migration.summary.total - 12} 首，将按原顺序处理</p>}
          </div>
          <footer>
            <span>执行前只显示预览；迁移结果和未匹配项会保留记录。</span>
            <button className="primary" disabled={migrationBusy === "execute" || !migrationTargets.length || (downloadMissing && !migrationSource)} onClick={executeMigration}>
              {migrationBusy === "execute" ? <LoaderCircle className="spin" /> : <ArrowDownToLine />}
              开始迁移
            </button>
          </footer>
        </section>
      )}
      {error && <div className="form-error"><CircleAlert />{error}</div>}
      <section className="connected-playlists panel">
        <header>
          <div>
            <span>已连接的音乐服务</span>
            <h2>服务歌单</h2>
            <p>Plex 与飞牛音乐中的歌单会在这里汇总显示。</p>
          </div>
          <button
            className="secondary small"
            onClick={loadServices}
            disabled={serviceBusy}
          >
            <RefreshCw className={serviceBusy ? "spin" : ""} />
            刷新
          </button>
        </header>
        <div className="service-playlist-grid">
          {[
            ["plex", "Plex", Server],
            ["fnos", "飞牛音乐", Radio],
          ].map(([id, label, Icon]) => {
            const service = servicePlaylists[id] || {};
            return (
              <article className="service-playlist-column" key={id}>
                <header>
                  <span><Icon /></span>
                  <div>
                    <strong>{label}</strong>
                    <small>
                      {service.configured
                        ? `${service.items?.length || 0} 个歌单`
                        : "尚未连接"}
                    </small>
                  </div>
                </header>
                {service.error ? (
                  <div className="service-playlist-message error">
                    <CircleAlert />
                    <span>{service.error}</span>
                  </div>
                ) : !service.configured ? (
                  <div className="service-playlist-message">
                    <Link2 />
                    <span>在设置中完成连接后，歌单会自动出现在这里。</span>
                  </div>
                ) : service.items?.length ? (
                  <div className="service-playlist-list">
                    {service.items.map((item, index) => (
                      <button
                        type="button"
                        key={`${id}-${item.id}`}
                        className={id !== "plex" ? "sync-only" : ""}
                        disabled={
                          id !== "plex" ||
                          servicePlaying === `${id}:${item.id}`
                        }
                        onClick={() => playServicePlaylist(id, item)}
                        aria-label={
                          id === "plex"
                            ? `播放歌单 ${item.name}`
                            : `查看飞牛音乐歌单 ${item.name} 的播放能力`
                        }
                      >
                        <span className={`playlist-tile tone-${index % 4}`}>
                          {item.coverUrl ? (
                            <img src={item.coverUrl} alt="" />
                          ) : (
                            <ListMusic />
                          )}
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.itemCount || 0} 首歌曲</small>
                        </div>
                        <em>
                          {servicePlaying === `${id}:${item.id}` ? (
                            <LoaderCircle className="spin" />
                          ) : id === "plex" ? (
                            <Play fill="currentColor" />
                          ) : (
                            label
                          )}
                        </em>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="service-playlist-message">
                    <ListMusic />
                    <span>服务已连接，暂时没有歌单。</span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <div className="playlist-workspace">
        <aside className="panel playlist-list">
          <form onSubmit={create}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新歌单名称" />
            <button className="primary icon-button" disabled={busy || !newName.trim()} aria-label="创建歌单"><Plus /></button>
          </form>
          {items.length ? items.map((item) => (
            <button
              key={item.id}
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => load(item.id).catch((err) => setError(err.message))}
            >
              <span><ListMusic /><strong>{item.name}</strong></span>
              <small>{item.itemCount} 首</small>
            </button>
          )) : <Empty icon={ListMusic} title="还没有歌单" text="创建一个空歌单，或导入 M3U/M3U8 文件。" />}
        </aside>
        <section className="panel playlist-detail">
          {!selected ? (
            <Empty icon={ListMusic} title="选择一个歌单" text="歌单内容、匹配状态和顺序会显示在这里。" />
          ) : (
            <>
              <header>
                <div>
                  <span>本地歌单</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.description || `${selected.itemCount} 首歌曲`}</p>
                </div>
                <div>
                  <button className="secondary" onClick={() => syncSelected("plex")} disabled={busy || !selected.items.length}>
                    <Server />同步 Plex
                  </button>
                  <button className="secondary" onClick={() => syncSelected("fnos")} disabled={busy || !selected.items.length}>
                    <Radio />同步飞牛音乐
                  </button>
                  <button className="primary" onClick={playAll} disabled={!selected.items.some(playable)}>
                    <Play />播放全部
                  </button>
                  <button className="icon-button danger" onClick={remove} aria-label="删除歌单"><Trash2 /></button>
                </div>
              </header>
              <div className="playlist-tracks">
                {selected.items.length ? selected.items.map((item, index) => (
                  <article key={item.id} className={!playable(item) ? "unmatched" : ""}>
                    <button
                      className="track-play"
                      disabled={!playable(item)}
                      onClick={() => playable(item) && playSelectedFrom(index)}
                      aria-label={playable(item) ? `播放 ${item.title}` : `${item.title} 尚未匹配`}
                    >
                      {item.file_id ? <Play /> : <CircleAlert />}
                    </button>
                    <span className="track-position">{index + 1}</span>
                    <div><strong>{item.title || "未命名歌曲"}</strong><small>{item.artist || "未知艺人"} · {item.album || "未知专辑"}</small></div>
                    <em>{playable(item) ? "可播放" : "待匹配"}</em>
                    <div className="track-order">
                      <button className="icon-button" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="上移"><ChevronDown className="rotate-180" /></button>
                      <button className="icon-button" onClick={() => move(index, 1)} disabled={busy || index === selected.items.length - 1} aria-label="下移"><ChevronDown /></button>
                    </div>
                  </article>
                )) : <Empty icon={Music2} title="空歌单" text="可以先导入 M3U，或从播放器把歌曲加入歌单。" />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function RecommendationPage({ play, navigate, isAdmin = true }) {
  const [data, setData] = useState({ profile: {}, items: [], eventCount: 0 });
  const [exploration, setExploration] = useState(0.35);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const applyRecommendationData = (value = {}) => {
    const normalized = {
      profile: value.profile || {},
      items: Array.isArray(value.items) ? value.items : [],
      eventCount: Number(value.eventCount || 0),
    };
    setData(normalized);
    return normalized;
  };
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/recommendations");
      const normalized = applyRecommendationData(result);
      if (!normalized.items.length) {
        const refreshed = await api("/api/recommendations/refresh", {
          method: "POST",
          body: JSON.stringify({ exploration, discoveries: [] }),
        });
        applyRecommendationData(refreshed);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const refresh = async () => {
    setBusy(true);
    try {
      applyRecommendationData(
        await api("/api/recommendations/refresh", {
          method: "POST",
          body: JSON.stringify({ exploration, discoveries: [] }),
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const profile = data.profile || {};
  const playRecommendation = (item) => {
    const target = recommendationPlaybackInput(item);
    if (target) play(target);
  };
  return (
    <div className="page recommendation-page refined-recommendation-page">
      <section className="recommendation-intro">
        <div>
          <span className="eyebrow"><Sparkles />FOR YOU</span>
          <h1>为你推荐</h1>
          <p>
            {profile.explanation ||
              "从你的收藏与播放习惯中挑选熟悉的声音，也留出发现新音乐的空间。"}
          </p>
        </div>
        <div className="exploration-control">
          <div>
            <span>熟悉度</span>
            <strong>{100 - Math.round(exploration * 100)}%</strong>
          </div>
          <input
            aria-label="推荐探索比例"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={exploration}
            onChange={(event) => setExploration(Number(event.target.value))}
          />
          <div>
            <span>探索度</span>
            <strong>{Math.round(exploration * 100)}%</strong>
          </div>
          <button className="secondary small" onClick={refresh} disabled={busy}>
            <RefreshCw className={busy ? "spin" : ""} />
            换一批
          </button>
        </div>
      </section>
      {error && (
        <div className="recommendation-error">
          <CircleAlert />
          <div>
            <strong>推荐暂时没有加载成功</strong>
            <span>{error}</span>
          </div>
          <button className="secondary small" onClick={load}>重试</button>
        </div>
      )}
      <section className="recommendation-signals" aria-label="推荐画像摘要">
        <div>
          <span>完整听完</span>
          <strong>{Math.round((profile.completionRate || 0) * 100)}%</strong>
          <small>完成率</small>
        </div>
        <i />
        <div>
          <span>快速跳过</span>
          <strong>{Math.round((profile.skipRate || 0) * 100)}%</strong>
          <small>跳过率</small>
        </div>
        <i />
        <div>
          <span>本地行为</span>
          <strong>{fmt(data.eventCount)}</strong>
          <small>不会上传完整历史</small>
        </div>
      </section>
      <section className="recommendation-profile">
        <article>
          <header>
            <h2>常听音乐人</h2>
            <span>收藏与完整播放的权重更高</span>
          </header>
          <div className="profile-tags">
            {(profile.topArtists || []).length ? (
              profile.topArtists.map((item) => (
                <span key={item.name}>
                  {item.name}
                  <small>{item.score}</small>
                </span>
              ))
            ) : (
              <p>继续播放与收藏，常听音乐人会逐渐浮现。</p>
            )}
          </div>
        </article>
        <article>
          <header>
            <h2>偏好年代与流派</h2>
            <span>只根据本地标签与播放行为计算</span>
          </header>
          <div className="profile-tags">
            {[...(profile.favoriteDecades || []), ...(profile.topGenres || [])]
              .length ? (
              [
                ...(profile.favoriteDecades || []),
                ...(profile.topGenres || []),
              ].map((item) => (
                <span key={item.name}>
                  {item.name}
                  <small>{item.score}</small>
                </span>
              ))
            ) : (
              <p>曲库标签越完整，推荐理由会越准确。</p>
            )}
          </div>
        </article>
      </section>
      <section className="recommendation-feed">
        <header className="recommendation-feed-head">
          <div>
            <span>今日发现</span>
            <h2>根据你的口味挑选</h2>
          </div>
          <small>已过滤 Live、伴奏、DJ 与重复版本</small>
        </header>
        {busy && !data.items.length ? (
          <PageLoader />
        ) : data.items.length ? (
          <div className="recommendation-grid">
            {data.items.slice(0, 24).map((item) => (
              <article key={item.id}>
                <div className="recommendation-cover"><Disc3 /><span>{item.inLibrary ? "库内" : "库外"}</span></div>
                <div><strong>{item.title}</strong><p>{item.artist}{item.album ? ` · ${item.album}` : ""}</p><small>{(item.reasons || []).join(" · ")}</small></div>
                {item.inLibrary ? (
                  <button className="icon-button" onClick={() => playRecommendation(item)} aria-label={`播放 ${item.title}`}><Play /></button>
                ) : isAdmin ? (
                  <button className="text-button recommendation-source-link" onClick={() => navigate("download")}>查找授权来源<ChevronRight /></button>
                ) : <em>可向管理员申请入库</em>}
              </article>
            ))}
          </div>
        ) : (
          <div className="recommendation-empty">
            <span><Sparkles /></span>
            <div>
              <strong>推荐正在认识你的口味</strong>
              <p>先从曲库播放或收藏几首歌曲，下一次刷新就会有更贴合的结果。</p>
            </div>
            <button className="secondary" onClick={() => navigate("library")}>
              打开音乐库
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ManagementHub({ navigate, stats, jobs, permissions = [] }) {
  const waiting = jobs.filter((job) => job.status === "waiting_confirm").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const can = (permission) =>
    permissions.includes(permission) || permissions.includes("manage_users");
  const visibleManagement = managementNav.filter((item) =>
    item.id === "sources"
      ? can("manage_sources")
      : item.id === "settings"
        ? false
        : can("manage_library"),
  );
  const managementGroups = [
    {
      id: "catalog",
      eyebrow: "文件与下载",
      title: "标签写入、歌曲下载与入库",
      items: visibleManagement.filter((item) =>
        ["local", "download"].includes(item.id),
      ),
    },
    {
      id: "metadata",
      eyebrow: "PLEX 资料",
      title: "歌手海报、简介与专辑封面",
      items: visibleManagement.filter((item) => item.id === "scrape"),
    },
    {
      id: "operations",
      eyebrow: "连接与运行",
      title: "服务、队列与故障",
      items: visibleManagement.filter((item) =>
        ["sources", "tasks"].includes(item.id),
      ),
    },
  ].filter((group) => group.items.length);
  const metrics = [
    [Music2, "歌曲", stats?.tracks, "catalog"],
    [CircleAlert, "待确认", waiting, waiting ? "warning" : "quiet"],
    [CircleAlert, "失败任务", failed, failed ? "danger" : "quiet"],
    [BookOpenText, "缺歌词", stats?.missingLyrics, "info"],
  ];
  return (
    <div className="page manage-page refined-manage-page">
      <section className="page-intro">
        <span className="eyebrow">
          <Gauge />
          MUSIC TOOLS
        </span>
        <h1>音乐工具</h1>
        <p>下载、标签写入、Plex 资料补全和任务状态都在首屏直接进入。</p>
      </section>
      <section className="manage-metrics" aria-label="曲库状态摘要">
        {metrics.map(([Icon, label, value, tone]) => (
          <article className={`manage-metric ${tone}`} key={label}>
            <span className="manage-metric-icon"><Icon /></span>
            <div>
              <small>{label}</small>
              <strong>{fmt(value)}</strong>
            </div>
          </article>
        ))}
      </section>
      <section className="manage-workspace">
        {managementGroups.map((group) => (
          <article className="manage-section" key={group.id}>
            <header>
              <span>{group.eyebrow}</span>
              <h2>{group.title}</h2>
            </header>
            <div className="manage-menu">
              {group.items.map((item) => (
                <button
                  className="manage-menu-row"
                  key={item.id}
                  onClick={() => navigate(item.id)}
                >
                  <span className="manage-menu-icon"><item.icon /></span>
                  <span className="manage-menu-copy">
                    <strong>{item.label}</strong>
                    <small>{item.desc}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

const pageMeta = {
  home: ["首页", ""],
  library: ["音乐库", "歌手、专辑与单曲"],
  playlists: ["歌单", "收藏、导入与迁移"],
  player: ["正在播放", ""],
  discover: ["为你推荐", "熟悉的旋律，也有新的发现"],
  me: ["收藏与历史", "你的音乐足迹"],
  manage: ["音乐工具", "下载、标签与 Plex 资料"],
  search: ["搜索", "歌曲、艺人、专辑与歌单"],
  local: ["本地曲库", "文件与目录"],
  scrape: ["资料补全", "封面、歌词与简介"],
  download: ["下载与入库", "授权来源与待整理文件"],
  sources: ["音乐源", "连接与可用性"],
  tasks: ["任务", "进度与历史"],
  settings: ["设置", "账号、连接与存储"],
};

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  useEffect(() => {
    api("/api/auth/status")
      .then((d) => {
        setAuthenticated(d.authenticated);
        setSetupRequired(Boolean(d.setupRequired));
      })
      .catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === null)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
      </div>
    );
  if (setupRequired)
    return (
      <SetupWizard
        onComplete={() => {
          setSetupRequired(false);
          setAuthenticated(true);
        }}
      />
    );
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return (
    <PlayerProvider>
      <AuthenticatedShell setAuthenticated={setAuthenticated} />
      <PwaInstallPrompt />
    </PlayerProvider>
  );
}

function AuthenticatedShell({ setAuthenticated }) {
  const [active, setActive] = useState(() =>
    pageFromPath(window.location.pathname),
  );
  const [routeRevision, setRouteRevision] = useState(0);
  const [menu, setMenu] = useState(false);
  const [stats, setStats] = useState(() => readFastCache("dashboard", {}));
  const [jobs, setJobs] = useState(() => readFastCache("jobs", []));
  const [sources, setSources] = useState(() => readFastCache("sources", []));
  const [settingsData, setSettingsData] = useState(() =>
    readFastCache("settings", {}),
  );
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [ambientIndex, setAmbientIndex] = useState(0);
  const [ambientDeck, setAmbientDeck] = useState([]);
  const [manualBackdrop, setManualBackdrop] = useState(null);
  const [appearance, setAppearance] = useState(() =>
    normalizeAppearance(storedJson("songlib-appearance", DEFAULT_APPEARANCE)),
  );
  const player = usePlayer();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = resolvedTheme(appearance.theme, prefersDark);
  const changeAppearance = useCallback((value) => {
    const normalized = normalizeAppearance(value);
    setAppearance(normalized);
    try {
      localStorage.setItem("songlib-appearance", JSON.stringify(normalized));
    } catch {
      // Live preview remains available even when persistent storage is blocked.
    }
  }, []);
  const updatePath = useCallback((path, { replace = false } = {}) => {
    if (window.location.pathname === path) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }, []);
  const navigate = useCallback(
    (page, { replace = false } = {}) => {
      const target = knownPage(page) ? page : "home";
      setManualBackdrop(null);
      setActive(target);
      updatePath(pathForPage(target), { replace });
    },
    [updatePath],
  );
  const load = async () => {
    setLoading(true);
    try {
      const [s, cfg, j, src] = await Promise.all([
        api("/api/dashboard"),
        api("/api/settings"),
        api("/api/jobs").catch(() => []),
        api("/api/sources").catch(() => []),
      ]);
      setStats(writeFastCache("dashboard", s));
      setSettingsData(writeFastCache("settings", cfg));
      setJobs(writeFastCache("jobs", Array.isArray(j) ? j : []));
      setSources(writeFastCache("sources", Array.isArray(src) ? src : []));
    } catch (err) {
      if (err.message.includes("登录")) setAuthenticated(false);
      else setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };
  const refreshJobs = async () =>
    setJobs(writeFastCache("jobs", await api("/api/jobs")));
  const refreshSources = useCallback(
    async () =>
      setSources(writeFastCache("sources", await api("/api/sources"))),
    [],
  );
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setManualBackdrop(null);
      setActive(pageFromPath(window.location.pathname));
      setRouteRevision((value) => value + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const title = pageMeta[active]?.[0];
    document.title = title ? `${title} - ${BRAND.fullName}` : BRAND.fullName;
  }, [active]);
  useEffect(() => {
    const canPoll =
      userIsAdmin(settingsData.user) ||
      settingsData.user?.permissions?.includes("manage_library");
    const jobPages = ["manage", "tasks", "download", "local", "scrape"];
    if (!canPoll || !jobPages.includes(active)) return undefined;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refreshJobs().catch(() => {});
    };
    const timer = setInterval(refreshVisible, 8000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [active, settingsData.user?.role, settingsData.user?.permissions?.join("|")]);
  const ambientImages = useMemo(
    () => (Array.isArray(stats?.heroImages) ? stats.heroImages : []),
    [stats?.heroImages],
  );
  useEffect(() => {
    setAmbientDeck(buildAmbientDeck(ambientImages));
    setAmbientIndex(0);
  }, [ambientImages]);
  useEffect(() => {
    if (active === "player" || manualBackdrop || ambientDeck.length < 2)
      return;
    const timer = setInterval(() => {
      if (ambientIndex + 1 < ambientDeck.length) {
        setAmbientIndex(ambientIndex + 1);
      } else {
        setAmbientDeck(buildAmbientDeck(ambientImages));
        setAmbientIndex(0);
      }
    }, 14000);
    return () => clearInterval(timer);
  }, [
    active,
    ambientDeck,
    ambientImages,
    ambientIndex,
    manualBackdrop,
  ]);
  const runJob = async (kind, payload = {}) => {
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ kind, payload }),
      });
      setToast({ message: "任务已加入队列" });
      refreshJobs();
      navigate("tasks");
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };
  const createDownload = async (item, sourceId, quality) => {
    try {
      const result = await api("/api/downloads", {
        method: "POST",
        body: JSON.stringify({ item, sourceId, quality }),
      });
      setToast({ message: `《${item.title}》已加入下载队列` });
      refreshJobs();
      return result;
    } catch (err) {
      setToast({ type: "error", message: err.message });
      throw err;
    }
  };
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearFastCache();
    setAuthenticated(false);
  };
  const playTrack = async (item, queue = []) => {
    await player.play(item, queue);
  };
  const isAdmin = userIsAdmin(settingsData.user);
  const permissions = settingsData.user?.permissions || [];
  const canManageLibrary = isAdmin || permissions.includes("manage_library");
  const canManageSources = isAdmin || permissions.includes("manage_sources");
  const canOpenManagement = canManageLibrary || canManageSources;
  const isMobile = useMediaQuery("(max-width: 780px)");
  useEffect(() => {
    if (
      !loading &&
      !canOpenManagement &&
      managementNav.some((item) => item.id === active)
    )
      navigate("home", { replace: true });
  }, [loading, canOpenManagement, active, navigate]);
  const [title, subtitle] = pageMeta[active] || pageMeta.home;
  const hero =
    manualBackdrop ||
    ambientDeck[ambientIndex % Math.max(ambientDeck.length, 1)] ||
    {};
  const playerTrack = player.currentTrack || {};
  const shellBackdrop = hero.imageUrl || VISUAL_FALLBACKS.artist;
  const showMiniPlayer = !!player.currentTrack && active !== "player";
  return (
    <div
      className={`app-shell visual-shell route-${active} ${showMiniPlayer ? "has-mini-player" : ""}`}
      data-font-size={settingsData.user?.fontSize || "standard"}
      data-theme={theme}
      style={appearanceStyle(appearance)}
    >
      <ArtistBackdrop imageUrl={shellBackdrop} />
      {(!isMobile || menu) && (
        <Sidebar
          active={active}
          onChange={navigate}
          open={menu}
          close={() => setMenu(false)}
          logout={logout}
          version={settingsData.version}
          openPlayer={() => navigate("player")}
          isAdmin={canOpenManagement}
        />
      )}
      <main className="main">
        {active !== "player" && <Topbar
          title={title}
          subtitle={subtitle}
          openMenu={() => setMenu(true)}
          onNavigate={navigate}
          logout={logout}
          profile={settingsData.user}
        />}
        {loading &&
          (active === "manage" ||
            managementNav.some(
              (item) => item.id !== "settings" && item.id === active,
            )) && (
          <div className="management-route-loading" aria-label="正在载入管理数据">
            <PageLoader />
          </div>
        )}
        {active === "home" && (
          <Dashboard
            stats={stats}
            jobs={jobs}
            loading={loading}
            navigate={navigate}
            runJob={runJob}
            isAdmin={canManageLibrary}
          />
        )}{" "}
        {active === "library" && (
          <MediaLibrary
            key={`library-${routeRevision}`}
            initialTab={libraryTabFromPath(window.location.pathname)}
            initialDetail={libraryDetailFromPath(window.location.pathname)}
            play={playTrack}
            previewBackdrop={setManualBackdrop}
            onDetailBackdrop={setManualBackdrop}
            onTabChange={(tab) => updatePath(pathForLibraryTab(tab))}
            onDetailChange={(detail, fallbackTab) =>
              updatePath(
                detail
                  ? pathForLibraryDetail(detail.type, detail.ratingKey)
                  : pathForLibraryTab(fallbackTab || "artists"),
              )
            }
          />
        )}{" "}
        {active === "playlists" && (
          <PlaylistsPage
            key={`playlists-${routeRevision}`}
            play={playTrack}
            notify={(message) => setToast({ message })}
            initialPlaylistId={playlistIdFromPath(window.location.pathname)}
            onPlaylistChange={(id, options) =>
              updatePath(pathForPlaylist(id), options)
            }
          />
        )}{" "}
        {active === "search" && (
          <GlobalSearchPage
            play={playTrack}
            navigate={navigate}
            isAdmin={canManageLibrary}
          />
        )}{" "}
        {active === "me" && <MePage navigate={navigate} />}{" "}
        {active === "manage" && canOpenManagement && (
          <ManagementHub
            navigate={navigate}
            stats={stats}
            jobs={jobs}
            permissions={
              isAdmin
                ? ["manage_users", "manage_library", "manage_sources"]
                : permissions
            }
          />
        )}{" "}
        {canManageLibrary && active === "local" && (
          <LocalLibraryPage
            runJob={runJob}
            play={playTrack}
            notify={(message) => setToast({ message })}
            navigate={navigate}
          />
        )}{" "}
        {canManageLibrary && active === "scrape" && (
          <ScrapeCenter jobs={jobs} navigate={navigate} settings={settingsData} />
        )}{" "}
        {canManageLibrary && active === "download" && (
          <DownloadCenter
            sources={sources}
            refreshSources={refreshSources}
            createDownload={createDownload}
            navigate={navigate}
            notify={(message) => setToast({ message })}
            playPreview={playTrack}
          />
        )}{" "}
        {canManageSources && active === "sources" && (
          <SourceManager
            sources={sources}
            refreshSources={refreshSources}
            notify={(message) => setToast({ message })}
          />
        )}{" "}
        {active === "discover" && (
          <RecommendationPage
            play={playTrack}
            navigate={navigate}
            isAdmin={canManageLibrary}
          />
        )}{" "}
        {active === "player" && (
          <NowPlayingPage
            player={player}
            navigate={navigate}
            playerSettings={settingsData.player}
          />
        )}{" "}
        {canManageLibrary && active === "tasks" && (
          <Tasks jobs={jobs} refresh={refreshJobs} navigate={navigate} />
        )}{" "}
        {active === "settings" && (
          <SettingsPage
            settings={settingsData}
            logout={logout}
            navigate={navigate}
            isAdmin={isAdmin}
            onSettingsChange={setSettingsData}
            appearance={appearance}
            onAppearanceChange={changeAppearance}
          />
        )}{" "}
        {isMobile && (
          <MobileNav
            active={active}
            change={navigate}
            isAdmin={canOpenManagement}
          />
        )}
      </main>
      {showMiniPlayer && (
        <MiniPlayer
          openPlayer={() => navigate("player")}
          navigate={navigate}
        />
      )}
      <Toast toast={toast} clear={() => setToast(null)} />
    </div>
  );
}

function MobileNav({ active, change, isAdmin = true }) {
  const labels = {
    home: "首页",
    library: "曲库",
    player: "播放",
    playlists: "歌单",
    manage: "工具",
    settings: "设置",
  };
  const items = mobileNavigationIds
    .map((id) => nav.find((item) => item.id === id))
    .filter((item) => item && (!item.admin || isAdmin));
  const highlighted = mobileNavigationTarget(
    active,
    managementNav.map((item) => item.id),
  );
  return (
    <nav
      className="mobile-nav mobile-only"
      aria-label="移动端主导航"
      style={{ "--mobile-nav-count": items.length }}
    >
      {items.map((item) => (
        <button
          className={highlighted === item.id ? "active" : ""}
          onClick={() => change(item.id)}
          key={item.id}
        >
          <item.icon />
          <span>{labels[item.id]}</span>
        </button>
      ))}
    </nav>
  );
}

createRoot(document.getElementById("root")).render(<App />);
