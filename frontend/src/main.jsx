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
import { BRAND } from "./config/brand";
import {
  csrfFromCookie,
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

const api = async (path, options = {}) => {
  const isForm = options.body instanceof FormData;
  const csrfToken = csrfFromCookie(document.cookie);
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
    String(options.method || "GET").toUpperCase(),
  );
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(unsafe && csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof data.detail === "string" ? data.detail : data.detail?.message;
    const error = new Error(
      data.message || detail || `è¯·æ±‚å¤±è´¥ (${response.status})`,
    );
    error.code = data.error_code || data.detail?.error_code;
    throw error;
  }
  return data;
};

const nav = [
  { id: "home", label: "é¦–é¡µ", icon: Home, group: "å‘çŽ°" },
  { id: "discover", label: "ä¸ºä½ æŽ¨è", icon: Sparkles, group: "å‘çŽ°" },
  { id: "library", label: "éŸ³ä¹åº“", icon: Library, group: "èµ„æ–™åº“" },
  { id: "playlists", label: "æ­Œå•", icon: ListMusic, group: "èµ„æ–™åº“" },
  { id: "me", label: "æ”¶è—ä¸ŽåŽ†å²", icon: Heart, group: "èµ„æ–™åº“" },
  { id: "manage", label: "ç®¡ç†ä¸­å¿ƒ", icon: Gauge, admin: true, group: "ç³»ç»Ÿ" },
  { id: "settings", label: "è®¾ç½®", icon: Settings, group: "ç³»ç»Ÿ" },
];

const managementNav = [
  {
    id: "local",
    label: "æœ¬åœ°æ›²åº“",
    icon: FolderTree,
    desc: "æµè§ˆæ–‡ä»¶ã€ç¼–è¾‘æ ‡ç­¾å¹¶æ’¤é”€æ•´ç†æ“ä½œ",
  },
  {
    id: "scrape",
    label: "åˆ®å‰Šä¸­å¿ƒ",
    icon: WandSparkles,
    desc: "å°é¢ã€æ­Œè¯ã€èƒŒæ™¯ã€ä¸­æ–‡ç®€ä»‹è¡¥é½",
  },
  {
    id: "download",
    label: "ä¸‹è½½å…¥åº“",
    icon: ArrowDownToLine,
    desc: "æœç´¢ã€ä¸‹è½½ã€ç¡®è®¤å…¥åº“ä¸Žå†²çªæ£€æŸ¥",
  },
  {
    id: "sources",
    label: "éŸ³ä¹æºç®¡ç†",
    icon: Wifi,
    desc: "æ·»åŠ æŽˆæƒæ¥æºå¹¶æ£€æŸ¥è¿žæŽ¥çŠ¶æ€",
  },
  {
    id: "tasks",
    label: "ä»»åŠ¡ä¸­å¿ƒ",
    icon: Activity,
    desc: "è¿è¡Œä¸­ã€å¾…ç¡®è®¤ã€å¤±è´¥ä¸ŽåŽ†å²ä»»åŠ¡",
  },
  {
    id: "settings",
    label: "ç³»ç»Ÿè®¾ç½®",
    icon: Settings,
    desc: "Plexã€è´¦å·ã€å®‰å…¨ã€æ—¥å¿—ä¸Žåå¥½",
  },
];

const fmt = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);
const pct = (value, total) => (total ? Math.round((value / total) * 100) : 0);
const durationLabel = (value) => {
  const seconds = Math.floor(Number(value || 0) / 1000);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} å°æ—¶ ${minutes} åˆ†é’Ÿ` : `${minutes} åˆ†é’Ÿ`;
};
const timeAgo = (value) => {
  if (!value) return "åˆšåˆš";
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)} ç§’å‰`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} åˆ†é’Ÿå‰`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} å°æ—¶å‰`;
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
    .replace(/^\s*\d{1,3}\s*[-_.ã€]\s*/, "")
    .replace(/\s*[-_.\s]+(?:official\s*)?(?:music\s*)?(?:video|mv)\s*$/i, "")
    .replace(
      /\s*\[(?:mqms2|hi-?res|flac|320k|128k|official|æ— æŸ|é«˜å“|mq)\]\s*/gi,
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
  active !== "settings" && managementNav.some((item) => item.id === active)
    ? "manage"
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
    window.addEventListener("before÷ÝuæÚ$z{-®éÜj×ãÂ÷7ãà¢ÆF—cà¢Ç6ÖÆÃç¶Æ&VÇÓÂ÷6ÖÆÃà¢Ç7G&öæsç¶f×B‡fÇVR—ÓÂ÷7G&öæsà¢ÂöF—cà¢Âö'F–6ÆSà¢’—Ð¢Â÷6V7F–öãà¢Ç6V7F–öâ6Æ74æÖSÒ&ÖævR×v÷&·76R#à¢¶ÖævVÖVçDw&÷W2æÖ‚†w&÷W’Óâ€¢Æ'F–6ÆR6Æ74æÖSÒ&ÖævR×6V7F–öâ"¶W“×¶w&÷Wæ–GÓà¢Æ†VFW#à¢Ç7ãç¶w&÷WæW–V'&÷wÓÂ÷7ãà¢Æƒ#ç¶w&÷WçF—FÆWÓÂöƒ#à¢Âö†VFW#à¢ÆF—b6Æ74æÖSÒ&ÖævRÖÖVçR#à¢¶w&÷Wæ—FV×2æÖ‚†—FVÒ’Óâ€¢Æ'WGFöà¢6Æ74æÖSÒ&ÖævRÖÖVçR×&÷r ¢¶W“×¶—FVÒæ–GÐ¢öä6Æ–6³×²‚’Óâæf–vFR†—FVÒæ–B—Ð¢à¢Ç7â6Æ74æÖSÒ&ÖævRÖÖVçRÖ–6öâ#ãÆ—FVÒæ–6öâóãÂ÷7ãà¢Ç7â6Æ74æÖSÒ&ÖævRÖÖVçRÖ6÷’#à¢Ç7G&öæsç¶—FVÒæÆ&VÇÓÂ÷7G&öæsà¢Ç6ÖÆÃç¶—FVÒæFW67ÓÂ÷6ÖÆÃà¢Â÷7ãà¢Ä6†Wg&öå&–v‡Bóà¢Âö'WGFöãà¢’—Ð¢ÂöF—cà¢Âö'F–6ÆSà¢’—Ð¢Â÷6V7F–öãà¢ÂöF—cà¢“°§ÐÐ Ð¦6öç7BvTÖWFÒ°¢†öÖS¢².šinšR"Â"%ÒÀ¢Æ–'&'“¢².™û>K™[©2"Â.jØÎh˜¾8K‰>‹éKˆîXÙ^i»"%ÒÀ¢Æ–Æ—7G3¢².jØÎXÙR"Â.iKn‰xþ8ZûÎXZ^Kˆî‹øz{²%ÒÀ¢Æ–W#¢².jÚ>YÊŽi*ÞiKâ"Â"%ÒÀ¢F—66÷fW#¢².K‹®KÚhêŽˆÙ"Â.xiþh(žy¨Nix¾[è¾ûÈÎK™þiÈžiky¨NXùxë%ÒÀ¢ÖS¢².iKn‰xþKˆîXènXû""Â.KÚy¨N™û>K™‹k>‹û’%ÒÀ¢ÖævS¢².zêynKŠÞ[ø2"Â.i».[©>8K»¾XªKˆîiÈÞXª%ÒÀ¢6V&6ƒ¢².i	Î{J""Â.jØÎi».8ˆ›®K«®8K‰>‹éKˆîjØÎXÙR%ÒÀ¢Æö6Ã¢².iÊÎYËi».[©2"Â.ih~K»nKˆîyºî[ÙR%ÒÀ¢67&S¢².‹XNiižŠ^XZ‚"Â.[™Ú.8jØÎŠøÞKˆîzèK¸²%ÒÀ¢F÷væÆöC¢².Kˆ¾‹ÛÞKˆîXZ^[©2"Â.hèŽiØ>iÚ^k©Kˆî[è^i[Nynih~K»b%ÒÀ¢6÷W&6W3¢².™û>K™k©"Â.‹ùîhê^KˆîXúþyJŽh
r%ÒÀ¢F6·3¢².K»¾Xª"Â.‹ù¾[ªnKˆîXènXû"%ÒÀ¢6WGF–æw3¢².Šëî{Úâ"Â.‹JnXû~8‹ùîhê^KˆîZÙŽX*‚%ÒÀ§Ó° Ð¦gVæ7F–öâ‚’°¢6öç7B¶WF†VçF–6FVBÂ6WDWF†VçF–6FVEÒÒW6U7FFR†çVÆÂ“°¢6öç7B·6WGW&WV—&VBÂ6WE6WGW&WV—&VEÒÒW6U7FFR†fÇ6R“°¢W6TVffV7B‚‚’Óâ°¢’‚"ö’öWF‚÷7FGW2"¢çF†Vâ‚†B’Óâ°¢6WDWF†VçF–6FVB†BæWF†VçF–6FVB“°¢6WE6WGW&WV—&VB„&ööÆVâ†Bç6WGW&WV—&VB’“°¢Ò¢æ6F6‚‚‚’Óâ6WDWF†VçF–6FVB†fÇ6R’“°¢ÒÂµÒ“°¢–b†WF†VçF–6FVBÓÓÒçVÆÂÐ¢&WGW&â€Ð¢ÆF—b6Æ74æÖSÒ&&ö÷B#àÐ¢Ä'&æBóàÐ¢ÄÆöFW$6—&6ÆR6Æ74æÖSÒ'7–â"óàÐ¢ÂöF—càÐ¢“°Ð¢–b‡6WGW&WV—&VB¢&WGW&â€¢Å6WGWv—¦&@¢öä6ö×ÆWFS×²‚’Óâ°¢6WE6WGW&WV—&VB†fÇ6R“°¢6WDWF†VçF–6FVB‡G'VR“°¢×Ð¢óà¢“°¢–b‚WF†VçF–6FVB’&WGW&âÄÆöv–âöäÆöv–ã×²‚’Óâ6WDWF†VçF–6FVB‡G'VR—Òóã°¢&WGW&â€Ð¢ÅÆ–W%&÷f–FW#àÐ¢ÄWF†VçF–6FVE6†VÆÂ6WDWF†VçF–6FVC×·6WDWF†VçF–6FVGÒóàÐ¢Åv–ç7FÆÅ&ö×BóàÐ¢ÂõÆ–W%&÷f–FW#àÐ¢“°Ð§ÐÐ Ð¦gVæ7F–öâWF†VçF–6FVE6†VÆÂ‡²6WDWF†VçF–6FVBÒ’°¢6öç7B¶7F—fRÂ6WD7F—fUÒÒW6U7FFR‚‚’Óà¢vTg&öÕF‚‡v–æF÷ræÆö6F–öâçF†æÖR’À¢“°¢6öç7B·&÷WFU&Wf—6–öâÂ6WE&÷WFU&Wf—6–öåÒÒW6U7FFRƒ“°¢6öç7B¶ÖVçRÂ6WDÖVçUÒÒW6U7FFR†fÇ6R“°¢6öç7B·7FG2Â6WE7FG5ÒÒW6U7FFR‡·Ò“°Ð¢6öç7B¶¦ö'2Â6WD¦ö'5ÒÒW6U7FFR…µÒ“°Ð¢6öç7B·6÷W&6W2Â6WE6÷W&6W5ÒÒW6U7FFR…µÒ“°Ð¢6öç7B·6WGF–æw4FFÂ6WE6WGF–æw4FFÒÒW6U7FFR‡·Ò“°Ð¢6öç7B¶ÆöF–ærÂ6WDÆöF–æuÒÒW6U7FFR‡G'VR“°Ð¢6öç7B·Fö7BÂ6WEFö7EÒÒW6U7FFR†çVÆÂ“°¢6öç7B¶Ö&–VçD–æFW‚Â6WDÖ&–VçD–æFW…ÒÒW6U7FFRƒ“°¢6öç7B¶Ö&–VçDFV6²Â6WDÖ&–VçDFV6µÒÒW6U7FFR…µÒ“°¢6öç7B¶ÖçVÄ&6¶G&÷Â6WDÖçVÄ&6¶G&÷ÒÒW6U7FFR†çVÆÂ“°¢6öç7BÆ–W"ÒW6UÆ–W"‚“°¢6öç7BWFFUF‚ÒW6T6ÆÆ&6²‚‡F‚Â²&WÆ6RÒfÇ6RÒÒ·Ò’Óâ°¢–b‡v–æF÷ræÆö6F–öâçF†æÖRÓÓÒF‚’&WGW&ã°¢v–æF÷ræ†—7F÷'•·&WÆ6Rò'&WÆ6U7FFR"¢'W6…7FFR%Ò‡·ÒÂ""ÂF‚“°¢ÒÂµÒ“°¢6öç7Bæf–vFRÒW6T6ÆÆ&6²€¢‡vRÂ²&WÆ6RÒfÇ6RÒÒ·Ò’Óâ°¢6öç7BF&vWBÒ¶æ÷våvR‡vR’òvR¢&†öÖR#°¢6WDÖçVÄ&6¶G&÷†çVÆÂ“°¢6WD7F—fR‡F&vWB“°¢WFFUF‚‡F„f÷%vR‡F&vWB’Â²&WÆ6RÒ“°¢ÒÀ¢·WFFUF…ÒÀ¢“°¢6öç7BÆöBÒ7–æ2‚’Óâ°Ð¢6WDÆöF–ær‡G'VR“°Ð¢G'’°Ð¢6öç7B·2Â6frÂ¢Â7&5ÒÒv—B&öÖ—6RæÆÂ…°Ð¢’‚"ö’öF6†&ö&B"’ÀÐ¢’‚"ö’÷6WGF–æw2"’ÀÐ¢’‚"ö’ö¦ö'2"’æ6F6‚‚‚’ÓâµÒ’ÀÐ¢’‚"ö’÷6÷W&6W2"’æ6F6‚‚‚’ÓâµÒ’ÀÐ¢Ò“°Ð¢6WE7FG2‡2“°Ð¢6WE6WGF–æw4FF†6fr“°Ð¢6WD¦ö'2„'&’æ—4'&’†¢’ò¢¢µÒ“°Ð¢6WE6÷W&6W2„'&’æ—4'&’‡7&2’ò7&2¢µÒ“°Ð¢Ò6F6‚†W'"’°Ð¢–b†W'"æÖW76vRæ–æ6ÇVFW2‚.y›¾[ÙR"’’6WDWF†VçF–6FVB†fÇ6R“°Ð¢VÇ6R6WEFö7B‡²G—S¢&W'&÷""ÂÖW76vS¢W'"æÖW76vRÒ“°Ð¢Òf–æÆÇ’°Ð¢6WDÆöF–ær†fÇ6R“°Ð¢ÐÐ¢Ó°Ð¢6öç7B&Vg&W6„¦ö'2Ò7–æ2‚’Óâ6WD¦ö'2†v—B’‚"ö’ö¦ö'2"’“°Ð¢6öç7B&Vg&W6…6÷W&6W2ÒW6T6ÆÆ&6²€¢7–æ2‚’Óâ6WE6÷W&6W2†v—B’‚"ö’÷6÷W&6W2"’’À¢µÒÀ¢“°¢W6TVffV7B‚‚’Óâ°¢ÆöB‚“°¢ÒÂµÒ“°¢W6TVffV7B‚‚’Óâ°¢6öç7Böå÷7FFRÒ‚’Óâ°¢6WDÖçVÄ&6¶G&÷†çVÆÂ“°¢6WD7F—fR‡vTg&öÕF‚‡v–æF÷ræÆö6F–öâçF†æÖR’“°¢6WE&÷WFU&Wf—6–öâ‚‡fÇVR’ÓâfÇVR²“°¢Ó°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚'÷7FFR"Âöå÷7FFR“°¢&WGW&â‚’Óâv–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"‚'÷7FFR"Âöå÷7FFR“°¢ÒÂµÒ“°¢W6TVffV7B‚‚’Óâ°Ð¢6öç7BF—FÆRÒvTÖWF¶7F—fUÓòå³Ó°Ð¢Fö7VÖVçBçF—FÆRÒF—FÆRòG·F—FÆWÒÒG´%$äBægVÆÄæÖWÖ¢%$äBægVÆÄæÖS°Ð¢ÒÂ¶7F—fUÒ“°Ð¢W6TVffV7B‚‚’Óâ°Ð¢6öç7BF–ÖW"Ò6WD–çFW'fÂ‚‚’Óâ°Ð¢–b€Ð¢W6W$—4FÖ–â‡6WGF–æw4FFçW6W"’ÇÀÐ¢6WGF–æw4FFçW6W#òçW&Ö—76–öç3òæ–æ6ÇVFW2‚&ÖævUöÆ–'&'’"Ð¢Ð¢&Vg&W6„¦ö'2‚’æ6F6‚‚‚’Óâ·Ò“°Ð¢ÒÂ#S“°Ð¢&WGW&â‚’Óâ6ÆV$–çFW'fÂ‡F–ÖW"“°Ð¢ÒÂ·6WGF–æw4FFçW6W#òç&öÆRÂ6WGF–æw4FFçW6W#òçW&Ö—76–öç3òæ¦ö–â‚'Â"•Ò“°Ð¢6öç7BÖ&–VçD–ÖvW2ÒW6TÖVÖò€¢‚’Óâ„'&’æ—4'&’‡7FG3òæ†W&ô–ÖvW2’ò7FG2æ†W&ô–ÖvW2¢µÒ’À¢·7FG3òæ†W&ô–ÖvW5ÒÀ¢“°¢W6TVffV7B‚‚’Óâ°¢6WDÖ&–VçDFV6²†'V–ÆDÖ&–VçDFV6²†Ö&–VçD–ÖvW2’“°¢6WDÖ&–VçD–æFW‚ƒ“°¢ÒÂ¶Ö&–VçD–ÖvW5Ò“°¢W6TVffV7B‚‚’Óâ°¢–b†7F—fRÓÓÒ'Æ–W""ÇÂÖçVÄ&6¶G&÷ÇÂÖ&–VçDFV6²æÆVæwF‚Â"¢&WGW&ã°¢6öç7BF–ÖW"Ò6WD–çFW'fÂ‚‚’Óâ°¢–b†Ö&–VçD–æFW‚²ÂÖ&–VçDFV6²æÆVæwF‚’°¢6WDÖ&–VçD–æFW‚†Ö&–VçD–æFW‚²“°¢ÒVÇ6R°¢6WDÖ&–VçDFV6²†'V–ÆDÖ&–VçDFV6²†Ö&–VçD–ÖvW2’“°¢6WDÖ&–VçD–æFW‚ƒ“°¢Ð¢ÒÂC“°¢&WGW&â‚’Óâ6ÆV$–çFW'fÂ‡F–ÖW"“°¢ÒÂ°¢7F—fRÀ¢Ö&–VçDFV6²À¢Ö&–VçD–ÖvW2À¢Ö&–VçD–æFW‚À¢ÖçVÄ&6¶G&÷À¢Ò“°¢6öç7B'Vä¦ö"Ò7–æ2†¶–æBÂ–ÆöBÒ·Ò’Óâ°Ð¢G'’°Ð¢v—B’‚"ö’ö¦ö'2"Â°Ð¢ÖWF†öC¢%õ5B"ÀÐ¢&öG“¢¥4ôâç7G&–æv–g’‡²¶–æBÂ–ÆöBÒ’ÀÐ¢Ò“°Ð¢6WEFö7B‡²ÖW76vS¢.K»¾Xª[{.XªXZ^™‰þX‰r"Ò“°¢&Vg&W6„¦ö'2‚“°¢æf–vFR‚'F6·2"“°¢Ò6F6‚†W'"’°Ð¢6WEFö7B‡²G—S¢&W'&÷""ÂÖW76vS¢W'"æÖW76vRÒ“°Ð¢ÐÐ¢Ó°Ð¢6öç7B7&VFTF÷væÆöBÒ7–æ2†—FVÒÂ6÷W&6T–BÂVÆ—G’’Óâ°Ð¢G'’°Ð¢6öç7B&W7VÇBÒv—B’‚"ö’öF÷væÆöG2"Â°Ð¢ÖWF†öC¢%õ5B"ÀÐ¢&öG“¢¥4ôâç7G&–æv–g’‡²—FVÒÂ6÷W&6T–BÂVÆ—G’Ò’ÀÐ¢Ò“°Ð¢6WEFö7B‡²ÖW76vS¢8¢G¶—FVÒçF—FÆWÞ8¾[{.XªXZ^Kˆ¾‹ÛÞ™‰þX‰vÒ“°Ð¢&Vg&W6„¦ö'2‚“°Ð¢&WGW&â&W7VÇC°Ð¢Ò6F6‚†W'"’°Ð¢6WEFö7B‡²G—S¢&W'&÷""ÂÖW76vS¢W'"æÖW76vRÒ“°Ð¢F‡&÷rW'#°Ð¢ÐÐ¢Ó°Ð¢6öç7BÆöv÷WBÒ7–æ2‚’Óâ°Ð¢v—B’‚"ö’öWF‚öÆöv÷WB"Â²ÖWF†öC¢%õ5B"Ò’æ6F6‚‚‚’Óâ·Ò“°Ð¢6WDWF†VçF–6FVB†fÇ6R“°Ð¢Ó°Ð¢6öç7BÆ•G&6²Ò7–æ2†—FVÒÂVWVRÒµÒ’Óâ°¢v—BÆ–W"çÆ’†—FVÒÂVWVR“°¢Ó°¢6öç7B—4FÖ–âÒW6W$—4FÖ–â‡6WGF–æw4FFçW6W"“°Ð¢6öç7BW&Ö—76–öç2Ò6WGF–æw4FFçW6W#òçW&Ö—76–öç2ÇÂµÓ°Ð¢6öç7B6äÖævTÆ–'&'’Ò—4FÖ–âÇÂW&Ö—76–öç2æ–æ6ÇVFW2‚&ÖævUöÆ–'&'’"“°Ð¢6öç7B6äÖævU6÷W&6W2Ò—4FÖ–âÇÂW&Ö—76–öç2æ–æ6ÇVFW2‚&ÖævU÷6÷W&6W2"“°Ð¢6öç7B6ä÷VäÖævVÖVçBÒ6äÖævTÆ–'&'’ÇÂ6äÖævU6÷W&6W3°¢6öç7B—4Öö&–ÆRÒW6TÖVF–VW'’‚"†Ö‚×v–GFƒ¢sƒ‚’"“°¢W6TVffV7B‚‚’Óâ°¢–b€¢ÆöF–ærb`¢6ä÷VäÖævVÖVçBb`¢ÖævVÖVçDæbç6öÖR‚†—FVÒ’Óâ—FVÒæ–BÓÓÒ7F—fR¢¢æf–vFR‚&†öÖR"Â²&WÆ6S¢G'VRÒ“°¢ÒÂ¶ÆöF–ærÂ6ä÷VäÖævVÖVçBÂ7F—fRÂæf–vFUÒ“°¢6öç7B·F—FÆRÂ7V'F—FÆUÒÒvTÖWF¶7F—fUÒÇÂvTÖWFæ†öÖS°Ð¢6öç7B†W&òÐ¢ÖçVÄ&6¶G&÷ÇÀ¢Ö&–VçDFV6µ¶Ö&–VçD–æFW‚RÖF‚æÖ‚†Ö&–VçDFV6²æÆVæwF‚Â•ÒÇÀ¢·Ó°¢6öç7BÆ–W%G&6²ÒÆ–W"æ7W'&VçEG&6²ÇÂ·Ó°Ð¢6öç7B6†VÆÄ&6¶G&÷ÐÐ¢7F—fRÓÓÒ'Æ–W" Ð¢ò6÷fW%W&Äf÷"‡Æ–W%G&6²’ÇÂd•5TÅôdÄÄ$4µ2çÆ–W Ð¢¢†W&òæ–ÖvUW&ÂÇÂd•5TÅôdÄÄ$4µ2æ'F—7C°Ð¢6öç7B&6¶G&÷Ò7F—fRÓÓÒ'Æ–W""òÆ–W$&6¶G&÷¢'F—7D&6¶G&÷°Ð¢6öç7B6†÷tÖ–æ•Æ–W"ÒÆ–W"æ7W'&VçEG&6²bb7F—fRÓÒ'Æ–W"#°Ð¢&WGW&â€Ð¢ÆF—`¢6Æ74æÖS×¶×6†VÆÂf—7VÂ×6†VÆÂ&÷WFRÒG¶7F—fWÒG·6†÷tÖ–æ•Æ–W"ò&†2ÖÖ–æ’×Æ–W""¢"'ÖÐ¢FFÖföçB×6—¦S×·6WGF–æw4FFçW6W#òæföçE6—¦RÇÂ'7FæF&B'Ð¢àÐ¢Ä&6¶G&÷–ÖvUW&Ã×·6†VÆÄ&6¶G&÷ÒóàÐ¢²‚—4Öö&–ÆRÇÂÖVçR’bb€Ð¢Å6–FV& Ð¢7F—fS×¶7F—fWÐÐ¢öä6†ævS×¶æf–vFWÐ¢÷Vã×¶ÖVçWÐÐ¢6Æ÷6S×²‚’Óâ6WDÖVçR†fÇ6R—ÐÐ¢Æöv÷WC×¶Æöv÷WGÐÐ¢fW'6–öã×·6WGF–æw4FFçfW'6–öçÐÐ¢÷VåÆ–W#×²‚’Óâæf–vFR‚'Æ–W""—Ð¢—4FÖ–ã×¶6ä÷VäÖævVÖVçGÐÐ¢óàÐ¢—ÐÐ¢ÆÖ–â6Æ74æÖSÒ&Ö–â#àÐ¢ÅF÷& ¢F—FÆS×·F—FÆWÐ¢7V'F—FÆS×·7V'F—FÆWÐ¢÷VäÖVçS×²‚’Óâ6WDÖVçR‡G'VR—Ð¢öäæf–vFS×¶æf–vFWÐ¢Æöv÷WC×¶Æöv÷WGÐ¢&öf–ÆS×·6WGF–æw4FFçW6W'Ð¢óà¢¶ÆöF–ærb`¢†7F—fRÓÓÒ&ÖævR"ÇÀ¢ÖævVÖVçDæbç6öÖR€¢†—FVÒ’Óâ—FVÒæ–BÓÒ'6WGF–æw2"bb—FVÒæ–BÓÓÒ7F—fRÀ¢’’bb€¢ÆF—b6Æ74æÖSÒ&ÖævVÖVçB×&÷WFRÖÆöF–ær"&–ÖÆ&VÃÒ.jÚ>YÊŽ‹ÛÞXZ^zêyni[hÚâ#à¢ÅvTÆöFW"óà¢ÂöF—cà¢—Ð¢¶7F—fRÓÓÒ&†öÖR"bb€¢ÄF6†&ö&@Ð¢7FG3×·7FG7ÐÐ¢¦ö'3×¶¦ö'7ÐÐ¢ÆöF–æs×¶ÆöF–æwÐÐ¢æf–vFS×¶æf–vFWÐ¢'Vä¦ö#×·'Vä¦ö'ÐÐ¢—4FÖ–ã×¶6äÖævTÆ–'&'—ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶7F—fRÓÓÒ&Æ–'&'’"bb€¢ÄÖVF–Æ–'&'¢¶W“×¶Æ–'&'’ÒG·&÷WFU&Wf—6–öçÖÐ¢–æ—F–ÅF#×¶Æ–'&'•F$g&öÕF‚‡v–æF÷ræÆö6F–öâçF†æÖR—Ð¢–æ—F–ÄFWF–Ã×¶Æ–'&'”FWF–Äg&öÕF‚‡v–æF÷ræÆö6F–öâçF†æÖR—Ð¢Æ“×·Æ•G&6·Ð¢&Wf–Wt&6¶G&÷×·6WDÖçVÄ&6¶G&÷Ð¢öäFWF–Ä&6¶G&÷×·6WDÖçVÄ&6¶G&÷Ð¢öåF$6†ævS×²‡F"’ÓâWFFUF‚‡F„f÷$Æ–'&'•F"‡F"’—Ð¢öäFWF–Ä6†ævS×²†FWF–ÂÂfÆÆ&6µF"’Óà¢WFFUF‚€¢FWF–À¢òF„f÷$Æ–'&'”FWF–Â†FWF–ÂçG—RÂFWF–Âç&F–æt¶W’¢¢F„f÷$Æ–'&'•F"†fÆÆ&6µF"ÇÂ&'F—7G2"’À¢¢Ð¢óà¢—×²"'Ð¢¶7F—fRÓÓÒ'Æ–Æ—7G2"bb€¢ÅÆ–Æ—7G5vP¢¶W“×¶Æ–Æ—7G2ÒG·&÷WFU&Wf—6–öçÖÐ¢Æ“×·Æ•G&6·Ð¢æ÷F–g“×²†ÖW76vR’Óâ6WEFö7B‡²ÖW76vRÒ—Ð¢–æ—F–ÅÆ–Æ—7D–C×·Æ–Æ—7D–Dg&öÕF‚‡v–æF÷ræÆö6F–öâçF†æÖR—Ð¢öåÆ–Æ—7D6†ævS×²†–BÂ÷F–öç2’Óà¢WFFUF‚‡F„f÷%Æ–Æ—7B†–B’Â÷F–öç2¢Ð¢óà¢—×²"'Ð¢¶7F—fRÓÓÒ'6V&6‚"bb€Ð¢ÄvÆö&Å6V&6…vPÐ¢Æ“×·Æ•G&6·ÐÐ¢æf–vFS×¶æf–vFWÐ¢—4FÖ–ã×¶6äÖævTÆ–'&'—ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶7F—fRÓÓÒ&ÖR"bbÄÖUvRæf–vFS×¶æf–vFWÒóç×²"'Ð¢¶7F—fRÓÓÒ&ÖævR"bb6ä÷VäÖævVÖVçBbb€Ð¢ÄÖævVÖVçD‡V Ð¢æf–vFS×¶æf–vFWÐ¢7FG3×·7FG7ÐÐ¢¦ö'3×¶¦ö'7ÐÐ¢W&Ö—76–öç3×°Ð¢—4FÖ–àÐ¢ò²&ÖævU÷W6W'2"Â&ÖævUöÆ–'&'’"Â&ÖævU÷6÷W&6W2%ÐÐ¢¢W&Ö—76–öç0Ð¢ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶6äÖævTÆ–'&'’bb7F—fRÓÓÒ&Æö6Â"bb€Ð¢ÄÆö6ÄÆ–'&'•vPÐ¢'Vä¦ö#×·'Vä¦ö'ÐÐ¢Æ“×·Æ•G&6·ÐÐ¢æ÷F–g“×²†ÖW76vR’Óâ6WEFö7B‡²ÖW76vRÒ—ÐÐ¢æf–vFS×¶æf–vFWÐ¢óàÐ¢—×²"'ÐÐ¢¶6äÖævTÆ–'&'’bb7F—fRÓÓÒ'67&R"bb€Ð¢Å67&T6VçFW"¦ö'3×¶¦ö'7Òæf–vFS×¶æf–vFWÒ6WGF–æw3×·6WGF–æw4FFÒóà¢—×²"'ÐÐ¢¶6äÖævTÆ–'&'’bb7F—fRÓÓÒ&F÷væÆöB"bb€¢ÄF÷væÆöD6VçFW ¢6÷W&6W3×·6÷W&6W7Ð¢&Vg&W6…6÷W&6W3×·&Vg&W6…6÷W&6W7Ð¢7&VFTF÷væÆöC×¶7&VFTF÷væÆöGÐ¢æf–vFS×¶æf–vFWÐ¢æ÷F–g“×²†ÖW76vR’Óâ6WEFö7B‡²ÖW76vRÒ—ÐÐ¢Æ•&Wf–Ws×·Æ•G&6·ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶6äÖævU6÷W&6W2bb7F—fRÓÓÒ'6÷W&6W2"bb€Ð¢Å6÷W&6TÖævW Ð¢6÷W&6W3×·6÷W&6W7ÐÐ¢&Vg&W6…6÷W&6W3×·&Vg&W6…6÷W&6W7ÐÐ¢æ÷F–g“×²†ÖW76vR’Óâ6WEFö7B‡²ÖW76vRÒ—ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶7F—fRÓÓÒ&F—66÷fW""bb€¢Å&V6öÖÖVæFF–öåvP¢Æ“×·Æ•G&6·Ð¢æf–vFS×¶æf–vFWÐ¢—4FÖ–ã×¶6äÖævTÆ–'&'—Ð¢óàÐ¢—×²"'ÐÐ¢¶7F—fRÓÓÒ'Æ–W""bb€Ð¢ÅÆ–W%vPÐ¢æf–vFS×¶æf–vFWÐ¢Æ–W%6WGF–æw3×·6WGF–æw4FFçÆ–W'ÐÐ¢—4FÖ–ã×¶6äÖævTÆ–'&'—ÐÐ¢óàÐ¢—×²"'ÐÐ¢¶6äÖævTÆ–'&'’bb7F—fRÓÓÒ'F6·2"bb€Ð¢ÅF6·2¦ö'3×¶¦ö'7Ò&Vg&W6ƒ×·&Vg&W6„¦ö'7Òæf–vFS×¶æf–vFWÒóà¢—×²"'ÐÐ¢¶7F—fRÓÓÒ'6WGF–æw2"bb€Ð¢Å6WGF–æw5vPÐ¢6WGF–æw3×·6WGF–æw4FFÐÐ¢Æöv÷WC×¶Æöv÷WGÐÐ¢æf–vFS×¶æf–vFWÐ¢—4FÖ–ã×¶—4FÖ–çÐ¢öå6WGF–æw46†ævS×·6WE6WGF–æw4FFÐ¢óà¢—×²"'ÐÐ¢¶—4Öö&–ÆRbb€Ð¢ÄÖö&–ÆTæ`Ð¢7F—fS×¶7F—fWÐÐ¢6†ævS×¶æf–vFWÐ¢—4FÖ–ã×¶6ä÷VäÖævVÖVçGÐÐ¢óàÐ¢—ÐÐ¢ÂöÖ–ãàÐ¢·6†÷tÖ–æ•Æ–W"bb€Ð¢ÄÖ–æ•Æ–W Ð¢÷VåÆ–W#×²‚’Óâæf–vFR‚'Æ–W""—Ð¢æf–vFS×¶æf–vFWÐ¢óàÐ¢—ÐÐ¢ÅFö7BFö7C×·Fö7GÒ6ÆV#×²‚’Óâ6WEFö7B†çVÆÂ—ÒóàÐ¢ÂöF—càÐ¢“°Ð§ÐÐ Ð¦gVæ7F–öâÖö&–ÆTæb‡²7F—fRÂ6†ævRÂ—4FÖ–âÒG'VRÒ’°¢6öç7BÆ&VÇ2Ò°¢†öÖS¢.šinšR"À¢Æ–'&'“¢.i».[©2"À¢Æ–Æ—7G3¢.jØÎXÙR"À¢F—66÷fW#¢.hêŽˆÙ"À¢ÖS¢.h‰y¨B"À¢Ó°¢6öç7B—FV×2ÒÖö&–ÆTæf–vF–öä–G0¢æÖ‚†–B’Óâæbæf–æB‚†—FVÒ’Óâ—FVÒæ–BÓÓÒ–B’¢æf–ÇFW"„&ööÆVâ“°¢6öç7B†–v†Æ–v‡FVBÒÖö&–ÆTæf–vF–öåF&vWB€¢7F—fRÀ¢ÖævVÖVçDæbæÖ‚†—FVÒ’Óâ—FVÒæ–B’À¢“°¢&WGW&â€¢Ææb6Æ74æÖSÒ&Öö&–ÆRÖæbÖö&–ÆRÖöæÇ’"&–ÖÆ&VÃÒ.z{¾XªŽzºþK‹¾ZûÎˆŠ¢#à¢¶—FV×2æÖ‚†—FVÒ’Óâ€Ð¢Æ'WGFöàÐ¢6Æ74æÖS×¶†–v†Æ–v‡FVBÓÓÒ—FVÒæ–Bò&7F—fR"¢"'ÐÐ¢öä6Æ–6³×²‚’Óâ6†ævR†—FVÒæ–B—ÐÐ¢¶W“×¶—FVÒæ–GÐÐ¢àÐ¢Æ—FVÒæ–6öâóàÐ¢Ç7ãç¶Æ&VÇ5¶—FVÒæ–E×ÓÂ÷7ãàÐ¢Âö'WGFöãàÐ¢’—ÐÐ¢ÂöæcàÐ¢“°Ð§ÐÐ Ð¦7&VFU&ö÷B†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'&ö÷B"’’ç&VæFW"ƒÄóâ“°Ð