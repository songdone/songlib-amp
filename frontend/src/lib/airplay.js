export const nativeAirPlayAvailable = (video) =>
  Boolean(
    video &&
      typeof video.webkitShowPlaybackTargetPicker === "function",
  );

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

export const airPlayStatePayload = ({ track, lyrics, player }) => ({
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
});
