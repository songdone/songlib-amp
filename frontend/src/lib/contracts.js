export const csrfFromCookie = (cookie = "") => {
  const value = String(cookie)
    .split("; ")
    .find((item) => item.startsWith("songlib_csrf="))
    ?.split("=")
    .slice(1)
    .join("=");
  return value ? decodeURIComponent(value) : "";
};

const plexReference = (item = {}) => {
  const ratingKey = item.plexRatingKey || item.ratingKey;
  return ratingKey ? `plex:${ratingKey}` : null;
};

export const playlistTrackPayload = (item = {}) => ({
  fileId: item.file_id || item.fileId || item.localFileId || null,
  externalRef:
    item.external_ref ||
    item.externalRef ||
    (item.sourceType === "plex_item" || item.source === "plex_item"
      ? plexReference(item)
      : null),
  title: item.title || "",
  artist: item.artist || "",
  album: item.album || "",
  duration: Number(item.duration || 0),
  path: item.path || item.file || null,
});

export const playlistPlaybackInput = (item = {}) => {
  const localFileId = item.file_id || item.fileId || item.localFileId;
  if (localFileId) {
    return {
      source: "local_file",
      localFileId,
      title: item.title || "",
      artist: item.artist || "",
      album: item.album || "",
      duration: Number(item.duration || 0),
    };
  }
  const reference = String(item.external_ref || item.externalRef || "");
  const plexRatingKey = reference.match(/^plex[:-](.+)$/)?.[1];
  if (!plexRatingKey) return null;
  return {
    source: "plex_item",
    ratingKey: plexRatingKey,
    title: item.title || "",
    artist: item.artist || "",
    album: item.album || "",
    duration: Number(item.duration || 0),
  };
};

export const recommendationPlaybackInput = (item = {}) => {
  const reference = String(item.external_ref || item.externalRef || "");
  if (!item.inLibrary || !reference.startsWith("local:")) return null;
  const localFileId = reference.slice(6);
  if (!localFileId) return null;
  return {
    source: "local_file",
    localFileId,
    title: item.title || "",
    artist: item.artist || "",
    album: item.album || "",
  };
};
