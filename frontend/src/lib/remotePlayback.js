const asNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

export const remotePositionSeconds = (
  session,
  polledAt = Date.now(),
  now = Date.now(),
) => {
  if (!session) return 0;
  const duration = asNumber(session.durationMs) / 1000;
  const base = asNumber(session.positionMs) / 1000;
  const elapsed = session.playing
    ? Math.max(0, asNumber(now) - asNumber(polledAt)) / 1000
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
