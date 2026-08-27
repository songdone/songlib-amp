import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredRemoteSession,
  reconcileRemoteSessionClock,
  remoteControlMessage,
  remotePositionSeconds,
  remoteTrack,
} from "../src/lib/remotePlayback.js";

test("stale Plex offsets never reset an advancing playback clock", () => {
  const first = reconcileRemoteSessionClock(null, {
    id: "phone",
    ratingKey: "42",
    positionMs: 12_000,
    durationMs: 30_000,
    playing: true,
  }, 1_000);
  const second = reconcileRemoteSessionClock(first, {
    id: "phone",
    ratingKey: "42",
    positionMs: 12_000,
    durationMs: 30_000,
    playing: true,
  }, 3_000);
  assert.equal(remotePositionSeconds(second, 0, 3_500), 14.5);
});

test("small clock drift is corrected gently while a real seek snaps", () => {
  const first = reconcileRemoteSessionClock(null, {
    id: "phone",
    ratingKey: "42",
    positionMs: 10_000,
    durationMs: 60_000,
    playing: true,
  }, 1_000);
  const corrected = reconcileRemoteSessionClock(first, {
    id: "phone",
    ratingKey: "42",
    positionMs: 11_500,
    durationMs: 60_000,
    playing: true,
  }, 2_000);
  assert.equal(corrected.clockPositionMs, 11_150);
  const sought = reconcileRemoteSessionClock(corrected, {
    id: "phone",
    ratingKey: "42",
    positionMs: 40_000,
    durationMs: 60_000,
    playing: true,
  }, 3_000);
  assert.equal(sought.clockPositionMs, 40_000);
});

test("a stale pause event freezes at the locally predicted position", () => {
  const first = reconcileRemoteSessionClock(null, {
    id: "phone",
    ratingKey: "42",
    positionMs: 10_000,
    durationMs: 60_000,
    playing: true,
  }, 1_000);
  const paused = reconcileRemoteSessionClock(first, {
    id: "phone",
    ratingKey: "42",
    positionMs: 10_000,
    durationMs: 60_000,
    playing: false,
  }, 3_000);
  assert.equal(remotePositionSeconds(paused, 0, 9_000), 12);
});

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
