import assert from "node:assert/strict";
import test from "node:test";

import {
  csrfFromCookie,
  playlistPlaybackInput,
  playlistTrackPayload,
  recommendationPlaybackInput,
} from "../src/lib/contracts.js";
import {
  libraryTabFromPath,
  pageFromPath,
  pathForLibraryTab,
  pathForPage,
  pathForPlaylist,
  playlistIdFromPath,
} from "../src/lib/routes.js";

test("unsafe requests can recover the encoded CSRF cookie", () => {
  assert.equal(
    csrfFromCookie("theme=dark; songlib_csrf=abc%2Fdef%3D; another=value"),
    "abc/def=",
  );
  assert.equal(csrfFromCookie("theme=dark"), "");
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
  assert.equal(pathForPlaylist("list/with space"), "/playlists/list%2Fwith%20space");
  assert.equal(
    playlistIdFromPath("/playlists/list%2Fwith%20space"),
    "list/with space",
  );
  assert.equal(pageFromPath("/playlists/abc123"), "playlists");
});
