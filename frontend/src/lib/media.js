import { playbackDurationSeconds } from "./contracts.js";

/**
 * 视觉兜底资源。
 *
 * 这里原先还有三张 SVG：fallback-cover-vinyl / fallback-artist / fallback-player。
 * 它们上面印着大号金色 "SONGLIB AMP / NO COVER ART" 水印，
 * 缺封面时整屏铺开就是一堵重复的品牌噪音，还会盖过真正有封面的内容。
 * 已经删除。
 *
 * 缺封面现在交给 components/ui/Cover：按标题哈希生成低饱和底色 + 标题首字，
 * 同一张专辑颜色稳定、不同专辑互相区分，安静但可辨认。
 * 缺背景图交给 styles/motion.css 的 .ambient 环境光晕。
 *
 * 不要再往这里加"带字的占位图"。
 */
export const VISUAL_FALLBACKS = Object.freeze({
  login: "/visuals/login-island.jpg",
});

export const coverUrlFor = (track) =>
  track?.albumCoverUrl ||
  track?.coverUrl ||
  track?.thumbUrl ||
  track?.raw?.coverUrl ||
  track?.raw?.thumbUrl ||
  "";

export const normalizeTrackTitle = (value) =>
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

export const trackIdentity = (track) => {
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

export const isPlayableDuration = (track) => {
  const seconds = playbackDurationSeconds(track?.duration);
  if (!seconds) return true;
  return seconds > 5 && seconds < 60 * 60 * 6;
};

export const sanitizeQueue = (items = [], current = null) => {
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

/*
 * 存进 /api/player/state 的曲目要瘦。
 *
 * 原来这里是**黑名单**（只剔掉 audioUrl / transcodeUrls / raw），于是 Plex
 * 的原始属性整份被存了下来 —— guid、librarySectionKey、musicAnalysisVersion、
 * playlistItemID、parentStudio……一条 50 个字段、1.6 KB。线上实测：
 * 队列 194 条 = 323 KB，加上 history 与 playEvents，**整个 player/state
 * 有 520 KB**，每次打开应用都要下载一遍，状态一变还要整份传回去。
 * 那条链路每个请求本来就有约 370ms 固定开销，这 520 KB 就是"卡顿"的一半。
 *
 * 改成白名单：只留恢复播放和列表显示真正用得上的字段。
 * 加字段的人请一并加进这张表 —— 黑名单会随着上游多一个字段就悄悄变胖，
 * 白名单不会。
 */
const PERSISTED_TRACK_FIELDS = [
  // 身份（trackIdentity 按这个顺序找）
  "id",
  "canonicalKey",
  "sourceType",
  "source",
  "plexRatingKey",
  "ratingKey",
  "localFileId",
  // 显示
  "title",
  "filename",
  "artist",
  "grandparentTitle",
  "album",
  "parentTitle",
  "duration",
  "coverUrl",
  "albumCoverUrl",
  "thumbUrl",
  "artistBackgroundUrl",
  // 恢复播放要用
  "file",
  "quality",
  "bitrate",
];

export const persistableTrack = (track) => {
  if (!track || track.sourceType === "source_preview") return null;
  const slim = {};
  for (const field of PERSISTED_TRACK_FIELDS) {
    const value = track[field];
    if (value !== undefined && value !== null && value !== "") slim[field] = value;
  }
  return slim;
};
