import assert from "node:assert/strict";
import test from "node:test";

import {
  csrfFromCookie,
  playbackDurationSeconds,
  playlistPlaybackInput,
  playlistTrackPayload,
  recommendationPlaybackInput,
  servicePlaylistPlaybackItems,
} from "../src/lib/contracts.js";
import {
  libraryDetailFromPath,
  libraryTabFromPath,
  pageFromPath,
  pathForLibraryDetail,
  pathForLibraryTab,
  pathForPage,
  pathForPlaylist,
  playlistIdFromPath,
} from "../src/lib/routes.js";
import {
  mobileNavigationIds,
  mobileNavigationTarget,
} from "../src/lib/navigation.js";
import { sourceCatalogReady } from "../src/lib/sources.js";
import { pwaInstallGuidance, pwaSecureOrigin } from "../src/lib/pwa.js";
import { buildAmbientDeck } from "../src/lib/ambient.js";
import {
  appearanceStyle,
  normalizeAppearance,
  resolvedTheme,
} from "../src/lib/appearance.js";
import { clearFastCache, readFastCache, writeFastCache } from "../src/lib/cache.js";

test("unsafe requests can recover the encoded CSRF cookie", () => {
  assert.equal(
    csrfFromCookie("theme=dark; songlib_csrf=abc%2Fdef%3D; another=value"),
    "abc/def=",
  );
  assert.equal(csrfFromCookie("theme=dark"), "");
});

test("appearance preferences are bounded and become live CSS variables", () => {
  const value = normalizeAppearance({
    theme: "light",
    glassBlur: 500,
    backdropOpacity: 0,
    fontScale: 1.12,
  });
  assert.equal(value.glassBlur, 44);
  assert.equal(value.backdropOpacity, 0.18);
  assert.equal(resolvedTheme(value.theme, true), "light");
  assert.equal(appearanceStyle(value)["--ui-font-scale"], 1.12);
});

test("fast cache hydrates the shell and can be cleared on logout", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    keys: () => values.keys(),
  };
  writeFastCache("dashboard", { tracks: 4028 }, storage);
  assert.deepEqual(readFastCache("dashboard", {}, storage), { tracks: 4028 });
  clearFastCache(storage);
  assert.deepEqual(readFastCache("dashboard", {}, storage), {});
});

test("playlist items preserve their stable local identity", () => {
  assert.deepEqual(
    playlistTrackPayload({
      file_id: "file-7",
      title: "晴天",
      artist: "周杰伦",
      duration: 269,
      path: "/music/周杰伦/晴天.flac",
    }),
    {
      fileId: "file-7",
      externalRef: null,
      title: "晴天",
      artist: "周杰伦",
      album: "",
      duration: 269,
      path: "/music/周杰伦/晴天.flac",
    },
  );
});

test("Plex playlist items keep a portable reference and remain playable", () => {
  const payload = playlistTrackPayload({
    sourceType: "plex_item",
    plexRatingKey: "7842",
    title: "When We Were Young",
    artist: "Adele",
    album: "25",
    duration: 290,
  });
  assert.equal(payload.externalRef, "plex:7842");
  assert.deepEqual(playlistPlaybackInput({
    external_ref: payload.externalRef,
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    duration: payload.duration,
  }), {
    source: "plex_item",
    ratingKey: "7842",
    title: "When We Were Young",
    artist: "Adele",
    album: "25",
    duration: 290,
  });
});

test("a connected Plex playlist becomes one ordered playback queue", () => {
  const queue = servicePlaylistPlaybackItems("plex", [
    {
      ratingKey: "11",
      title: "晴天",
      grandparentTitle: "周杰伦",
      parentTitle: "叶惠美",
      duration: 269000,
    },
    {
      ratingKey: "12",
      title: "夜曲",
      artist: "周杰伦",
      album: "十一月的萧邦",
      duration: 226000,
    },
  ]);
  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((item) => item.ratingKey),
    ["11", "12"],
  );
  assert.equal(queue[0].source, "plex_item");
  assert.equal(queue[0].artist, "周杰伦");
  assert.deepEqual(
    queue.map((item) => item.duration),
    [269, 226],
  );
  assert.deepEqual(servicePlaylistPlaybackItems("fnos", queue), []);
});

test("Plex millisecond durations remain valid player queue durations", () => {
  assert.equal(playbackDurationSeconds(269000), 269);
  assert.equal(playbackDurationSeconds(269), 269);
  assert.equal(playbackDurationSeconds(undefined), 0);
  assert.equal(
    playlistPlaybackInput({
      external_ref: "plex:7842",
      duration: 269000,
    }).duration,
    269,
  );
});

test("only library recommendations become direct playback actions", () => {
  assert.deepEqual(
    recommendationPlaybackInput({
      inLibrary: true,
      external_ref: "local:file-9",
      title: "夜曲",
      artist: "周杰伦",
    }),
    {
      source: "local_file",
      localFileId: "file-9",
      title: "夜曲",
      artist: "周杰伦",
      album: "",
    },
  );
  assert.equal(
    recommendationPlaybackInput({
      inLibrary: false,
      external_ref: "provider:track-1",
      title: "库外歌曲",
    }),
    null,
  );
});

test("every primary and management page has a durable URL", () => {
  assert.equal(pathForPage("discover"), "/discover");
  assert.equal(pathForPage("local"), "/manage/library");
  assert.equal(pathForPage("download"), "/manage/downloads");
  assert.equal(pageFromPath("/manage/metadata"), "scrape");
  assert.equal(pageFromPath("/discover/"), "discover");
});

test("library tabs and playlist details keep their secondary URL", () => {
  assert.equal(pathForLibraryTab("albums"), "/library/albums");
  assert.equal(libraryTabFromPath("/library/tracks"), "tracks");
  assert.equal(pageFromPath("/library/tracks"), "library");
  assert.equal(
    pathForLibraryDetail("artists", "artist/42"),
    "/library/artists/artist%2F42",
  );
  assert.deepEqual(
    libraryDetailFromPath("/library/albums/album%2F88"),
    { type: "albums", ratingKey: "album/88" },
  );
  assert.equal(pageFromPath("/library/artists/42"), "library");
  assert.equal(pathForPlaylist("list/with space"), "/playlists/list%2Fwith%20space");
  assert.equal(
    playlistIdFromPath("/playlists/list%2Fwith%20space"),
    "list/with space",
  );
  assert.equal(pageFromPath("/playlists/abc123"), "playlists");
});

test("mobile navigation stays on one five-item row", () => {
  assert.deepEqual(mobileNavigationIds, [
    "home",
    "discover",
    "library",
    "playlists",
    "me",
  ]);
  assert.equal(mobileNavigationTarget("settings"), "me");
  assert.equal(mobileNavigationTarget("sources", ["sources", "tasks"]), "me");
  assert.equal(mobileNavigationTarget("library"), "library");
});

test("an inspected source is immediately available without a search-test gate", () => {
  const source = {
    enabled: true,
    searchOk: false,
    inspectResult: {
      ok: true,
      catalog_search_adapter: true,
      methods: { resolve: true },
    },
  };
  assert.equal(sourceCatalogReady(source), true);
  assert.equal(sourceCatalogReady({ ...source, enabled: false }), false);
});

test("PWA install guidance never exposes a no-op install action", () => {
  assert.equal(
    pwaSecureOrigin({
      protocol: "http:",
      hostname: "192.168.31.28",
      isSecureContext: false,
    }),
    false,
  );
  assert.deepEqual(
    pwaInstallGuidance({
      hasPrompt: false,
      secureOrigin: false,
      userAgent: "Chrome",
    }).actionLabel,
    "查看 HTTPS 要求",
  );
  assert.equal(
    pwaInstallGuidance({
      hasPrompt: true,
      secureOrigin: true,
      userAgent: "Chrome",
    }).actionLabel,
    "安装应用",
  );
});

test("ambient deck keeps every unique artist image and prioritizes larger libraries", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    imageUrl: `/artists/${index}.jpg`,
    trackCount: 20 - index,
  }));
  items.push({ imageUrl: "/artists/0.jpg", trackCount: 999 });
  const deck = buildAmbientDeck(items, () => 0.5);
  assert.equal(deck.length, 20);
  assert.equal(new Set(deck.map((item) => item.imageUrl)).size, 20);
  assert.ok(
    deck
      .slice(0, 8)
      .every((item) => Number(item.trackCount) >= 13),
  );
});
