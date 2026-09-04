export const nativeAirPlayAvailable = (video) =>
  Boolean(
    video &&
      typeof video.webkitShowPlaybackTargetPicker === "function",
  );

/*
 * 把歌词视频喂起来，让它成为一个**真正在播放、且看得见**的媒体会话。
 *
 * 这三件事每一件都是必需的，缺一件 Safari 就会把 AirPlay 路由绑到别处
 * （通常是音频/Now Playing 会话）—— 电视上于是显示"封面 + 歌名"的
 * 标准音频投屏画面，而不是我们的歌词页。用户拍照实证过一次。
 *
 * 1. **不能 muted。** 这条流刻意带了一条静音 AAC 轨
 *    （服务端的 audioMode = dual-clock-silent-aac），实测 mean_volume
 *    是 -91.0 dB，等于数字静音。带着音轨的目的就是让 WebKit 认它是一个
 *    完整的音视频会话、有资格拿走路由 —— 而 `muted` 正好把这个作用抵消。
 *    所以这里显式解除静音（反正听不见），只是把音量留在最大让它像正常媒体。
 * 2. **必须看得见。** `.airplay-cast-video` 默认是
 *    `visibility:hidden; opacity:0`，Safari 不会把隐藏的视频投出去。
 *    这里连行内样式一起写死，免得任何一层 CSS 又把它藏起来。
 * 3. **必须真的在播。** 见调用方：设备选择器要在视频已经 playing
 *    之后才有绑对的把握。
 */
export const primeAirPlayVideo = (video, streamUrl) => {
  if (!video || !streamUrl) {
    return Promise.reject(new Error("歌词视频地址尚未准备好"));
  }
  video.classList?.add("is-active");
  if (video.currentSrc !== streamUrl && video.src !== streamUrl) {
    video.src = streamUrl;
  }
  video.defaultMuted = false;
  video.muted = false;
  video.volume = 1;
  video.preload = "auto";
  if (video.style) {
    video.style.visibility = "visible";
    video.style.opacity = "1";
    video.style.transform = "none";
  }
  video.load();
  /*
   * 先按"不静音"起播；被自动播放策略拒了就退回静音再试一次。
   *
   * 不静音是为了让 WebKit 认它是完整的音视频会话（见上面那段）。但不静音
   * 的 play() 需要用户手势 —— 手势里调没问题，路由建立之后的自动恢复
   * 就未必。真机上验不了这一步，所以做成"降级而不是失败"：
   * 万一判断错了，最差也只是退回到改之前的行为。
   */
  return Promise.resolve(video.play()).catch((error) => {
    video.defaultMuted = true;
    video.muted = true;
    return Promise.resolve(video.play()).catch(() => {
      throw error;
    });
  });
};

/** 视频是不是已经"真的在播"——有画面、在走、没暂停。 */
export const airPlayVideoIsLive = (video) =>
  Boolean(
    video &&
      !video.paused &&
      !video.ended &&
      video.readyState >= 2 &&
      video.videoWidth > 0,
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
