const asNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const trackIdentity = (session) =>
  String(
    session?.ratingKey ||
      `${session?.title || ""}|${session?.artist || ""}|${session?.durationMs || 0}`,
  );

export const reconcileRemoteSessionClock = (
  previous,
  incoming,
  receivedAt = Date.now(),
) => {
  const at = asNumber(receivedAt);
  const durationMs = asNumber(incoming?.durationMs);
  const rawPositionMs = durationMs
    ? Math.min(asNumber(incoming?.positionMs), durationMs)
    : asNumber(incoming?.positionMs);
  const sameTrack =
    previous && trackIdentity(previous) === trackIdentity(incoming);

  if (!sameTrack) {
    return {
      ...incoming,
      rawPositionMs,
      clockPositionMs: rawPositionMs,
      clockAt: at,
    };
  }

  const previousAt = asNumber(previous.clockAt || at);
  const previousBase = asNumber(
    previous.clockPositionMs ?? previous.positionMs,
  );
  const predicted = previous.playing
    ? previousBase + Math.max(0, at - previousAt)
    : previousBase;
  const boundedPrediction = durationMs
    ? Math.min(predicted, durationMs)
    : predicted;
  const previousRaw = asNumber(
    previous.rawPositionMs ?? previous.positionMs,
  );
  const rawChanged = Math.abs(rawPositionMs - previousRaw) >= 250;
  let anchor = boundedPrediction;

  if (!incoming?.playing) {
    if (rawChanged) anchor = rawPositionMs;
  } else if (rawChanged) {
    const drift = rawPositionMs - boundedPrediction;
    anchor =
      Math.abs(drift) >= 4000
        ? rawPositionMs
        : boundedPrediction + clamp(drift * 0.35, -150, 150);
  }

  anchor = durationMs
    ? clamp(anchor, 0, durationMs)
    : Math.max(0, anchor);
  return {
    ...incoming,
    rawPositionMs,
    clockPositionMs: anchor,
    clockAt: at,
  };
};

export const remotePositionSeconds = (
  session,
  polledAt = Date.now(),
  now = Date.now(),
) => {
  if (!session) return 0;
  const duration = asNumber(session.durationMs) / 1000;
  const base = asNumber(session.clockPositionMs ?? session.positionMs) / 1000;
  const anchorAt = asNumber(session.clockAt ?? polledAt);
  const elapsed = session.playing
    ? Math.max(0, asNumber(now) - anchorAt) / 1000
    : 0;
  const position = base + elapsed;
  return duration ? Math.min(position, duration) : position;
};

export const preferredRemoteSession = (sessions = [], selectedId = "") => {
  const selected = sessions.find((item) => item.id === selectedId);
  if (selected) return selected;
  return sessions.find((item) => item.playing) || sessions[0] || null;
};

export const remoteTrack = (session, metadata = {}) => {
  if (!session) return null;
  return {
    id: `plex-session-${session.id}`,
    sourceType: "plex_session",
    plexRatingKey: session.ratingKey || "",
    title: metadata.title || session.title || "未命名歌曲",
    artist: metadata.artist || session.artist || "未知歌手",
    album: metadata.album || session.album || "",
    duration: asNumber(metadata.duration || session.durationMs / 1000),
    coverUrl: metadata.coverUrl || session.coverUrl || "",
    artistBackgroundUrl: metadata.artistBackgroundUrl || "",
    lyrics: metadata.lyrics || "",
    quality: "Plex",
    deviceName: session.deviceName || "Plex 播放器",
    sessionId: session.id,
    clientId: session.clientId || "",
    controllable: Boolean(session.controllable),
  };
};

export const remoteControlMessage = (session) => {
  if (!session) return "尚未选择 Plex 播放设备";
  if (session.controllable) return "可在 SongLib 中控制播放、暂停、切歌和进度";
  return session.controlReason || "这个设备只能跟随歌曲与进度";
};

/*
 * 抢完 AirPlay 路由之后，该让谁接着放？
 *
 * 抢路由那一下必须给歌词视频解除静音，否则 WebKit 会把 AirPlay 绑到音频
 * 会话上，电视只显示封面。代价是 iOS 的音频会话独占 —— Safari 一出声，
 * 同一台手机上正在放的东西就被按停了。本地播放这一路一直有人管；跟随
 * Plexamp 那一路原来写着"音乐在 Plexamp 那边，不归我们管"直接返回，
 * 于是投是投上了，歌却没了。
 *
 * 判断"它本来在放"看的是**最后一次看见它在放**的时刻，不是当下的 playing：
 * Plexamp 正是被我们按停的，等路由建立好回调进来时，轮询早就把 playing
 * 刷成 false 了，读当下等于自己把自己判成"用户不想听"。
 */
export const CAST_RESUME_GRACE_MS = 20_000;

export function castResumeTarget({
  usingRemote,
  remotePlayingSeenAt = 0,
  hasLocalTrack = false,
  now = Date.now(),
  graceMs = CAST_RESUME_GRACE_MS,
}) {
  if (usingRemote) {
    // 0 是"从没见它在放"，不是"1970 年在放过"。不单独挡掉的话，
    // 开机头 20 秒里这两者会被算成同一件事。
    if (!remotePlayingSeenAt) return null;
    return now - remotePlayingSeenAt <= graceMs ? "remote" : null;
  }
  return hasLocalTrack ? "local" : null;
}
