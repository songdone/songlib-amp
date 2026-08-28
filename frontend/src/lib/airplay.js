export const nativeAirPlayAvailable = (video) =>
  Boolean(
    video &&
      typeof video.webkitShowPlaybackTargetPicker === "function",
  );

export const airPlayLiveLatencyMs = (video) => {
  try {
    const ranges = video?.seekable;
    if (!ranges?.length) return 0;
    const liveEdge = Number(ranges.end(ranges.length - 1));
    const current = Number(video.currentTime);
    if (!Number.isFinite(liveEdge) || !Number.isFinite(current)) return 0;
    const latency = Math.max(0, Math.min(5, liveEdge - current));
    return Math.round((latency * 1000) / 50) * 50;
  } catch {
    return 0;
  }
};

export const airPlayTrackId = (track) => {
  if (!track) return "";
  const source = track.sourceType || track.source || "unknown";
  const id =
    track.localFileId ||
    track.plexRatingKey ||
    track.ratingKey ||
    track.raw?.id ||
    track.raw?.ratingKey ||
    track.id ||
    `${track.artist || ""}:${track.album || ""}:${track.title || ""}`;
  return `${source}:${id}`;
};

export const airPlayStatePayload = ({
  track,
  lyrics,
  player,
  lyricsOffsetMs = 0,
  transportLatencyMs = 0,
}) => ({
  trackId: airPlayTrackId(track),
  title: String(track?.title || "未命名歌曲"),
  artist: String(track?.artist || "未知歌手"),
  album: String(track?.album || "未知专辑"),
  quality: String(player?.quality || track?.quality || ""),
  lyrics: String(lyrics || track?.lyrics || ""),
  position: Math.max(0, Number(player?.currentTime || 0)),
  duration: Math.max(0, Number(player?.duration || track?.duration || 0)),
  playing: Boolean(player?.isPlaying),
  sourceType: String(track?.sourceType || track?.source || ""),
  localFileId: String(track?.localFileId || (track?.sourceType === "local_file" ? track?.raw?.id || "" : "")),
  plexRatingKey: String(track?.plexRatingKey || track?.ratingKey || track?.raw?.ratingKey || ""),
  coverKey: String(
    track?.albumCoverUrl ||
      track?.coverUrl ||
      track?.thumbUrl ||
      track?.raw?.coverUrl ||
      track?.raw?.thumbUrl ||
      "",
  ),
  lyricsOffsetMs: Math.max(-5000, Math.min(5000, Math.round(Number(lyricsOffsetMs || 0)))),
  transportLatencyMs: Math.max(
    0,
    Math.min(5000, Math.round(Number(transportLatencyMs || 0))),
  ),
});
