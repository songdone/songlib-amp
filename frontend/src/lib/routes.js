const PAGE_PATHS = Object.freeze({
  home: "/",
  discover: "/discover",
  library: "/library/artists",
  playlists: "/playlists",
  me: "/me",
  manage: "/manage",
  local: "/manage/library",
  scrape: "/manage/metadata",
  download: "/manage/downloads",
  sources: "/manage/sources",
  tasks: "/manage/tasks",
  settings: "/settings",
  player: "/player",
  search: "/search",
});

const PATH_PAGES = Object.freeze(
  Object.entries(PAGE_PATHS).reduce(
    (result, [page, path]) => ({ ...result, [path]: page }),
    {},
  ),
);

const normalizePath = (pathname = "/") => {
  const path = `/${String(pathname).split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? path : path.replace(/\/+$/g, "");
};

export const pathForPage = (page) => PAGE_PATHS[page] || PAGE_PATHS.home;

export const pageFromPath = (pathname) => {
  const path = normalizePath(pathname);
  if (PATH_PAGES[path]) return PATH_PAGES[path];
  if (path === "/library") return "library";
  if (/^\/library\/(?:artists|albums|tracks)$/.test(path)) return "library";
  if (/^\/playlists\/[^/]+$/.test(path)) return "playlists";
  return "home";
};

export const libraryTabFromPath = (pathname) => {
  const tab = normalizePath(pathname).match(
    /^\/library\/(artists|albums|tracks)$/,
  )?.[1];
  return tab || "artists";
};

export const pathForLibraryTab = (tab) =>
  `/library/${["artists", "albums", "tracks"].includes(tab) ? tab : "artists"}`;

export const playlistIdFromPath = (pathname) => {
  const value = normalizePath(pathname).match(/^\/playlists\/([^/]+)$/)?.[1];
  return value ? decodeURIComponent(value) : "";
};

export const pathForPlaylist = (playlistId) =>
  playlistId
    ? `/playlists/${encodeURIComponent(String(playlistId))}`
    : PAGE_PATHS.playlists;

export const knownPage = (page) =>
  Object.prototype.hasOwnProperty.call(PAGE_PATHS, page);
