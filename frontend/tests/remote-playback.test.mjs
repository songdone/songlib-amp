import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredRemoteSession,
  remoteControlMessage,
  remotePositionSeconds,
  remoteTrack,
} from "../src/lib/remotePlayback.js";

test("remote playback clock advances from the Plex poll timestamp", () => {
  assert.equal(
    remotePositionSeconds(
      { positionMs: 12_000, durationMs: 20_000, playing: true },
      1_000,
      4_500,
    ),
    15.5,
  );
  assert.equal(
    remotePositionSeconds(
      { positionMs: 19_500, durationMs: 20_000, playing: true },
      1_000,
      4_500,
    ),
    20,
  );
});

test("an explicitly selected session wins, otherwise the playing session wins", () => {
  const sessions = [
    { id: "paused", playing: false },
    { id: "playing", playing: true },
  ];
  assert.equal(preferredRemoteSession(sessions, "paused").id, "paused");
  assert.equal(preferredRemoteSession(sessions).id, "playing");
});

test("remote session becomes an AirPlay-compatible track without an audio URL", () => {
  const track = remoteTrack(
    {
      id: "session-1",
      ratingKey: "42",
      title: "夜曲",
      artist: "周杰伦",
      durationMs: 242000,
      clientId: "plexamp-1",
      deviceName: "客厅 Plexamp",
      controllable: true,
    },
    { lyrics: "[00:01.00]为你弹奏", coverUrl: "/cover" },
  );
  assert.equal(track.sourceType, "plex_session");
  assert.equal(track.duration, 242);
  assert.equal(track.lyrics, "[00:01.00]为你弹奏");
  assert.equal(track.audioUrl, undefined);
  assert.match(remoteControlMessage({ controllable: false, controlReason: "仅跟随" }), /仅跟随/);
});
