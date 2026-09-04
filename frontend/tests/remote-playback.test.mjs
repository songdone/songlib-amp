import assert from "node:assert/strict";
import test from "node:test";

import {
  castResumeTarget,
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

test("抢完 AirPlay 路由之后，被按停的那一路要有人续播", () => {
  const now = 10_000;
  // 跟随 Plexamp：解除静音把它按停了，得让它接着放。
  assert.equal(
    castResumeTarget({ usingRemote: true, remotePlayingSeenAt: 8_000, now }),
    "remote",
  );
  // 读"当下的 playing"会踩的坑：Plexamp 已经被我们按停、轮询也刷成
  // false 了，但它明明是刚才还在放的 —— 看的必须是"最后一次在放"。
  assert.equal(
    castResumeTarget({ usingRemote: true, remotePlayingSeenAt: now - 1, now }),
    "remote",
  );
  // 用户自己按的暂停不能顶掉：很久没在放就别自作主张。
  assert.equal(
    castResumeTarget({ usingRemote: true, remotePlayingSeenAt: now - 60_000, now }),
    null,
  );
  // 0 是"从没见它在放"。不单独挡掉的话，开机头 20 秒里它会被当成
  // "刚刚还在放"，投个屏就凭空把 Plexamp 点开了。
  assert.equal(
    castResumeTarget({ usingRemote: true, remotePlayingSeenAt: 0, now: 5_000 }),
    null,
  );
  // 本地播放这一路照旧。
  assert.equal(
    castResumeTarget({ usingRemote: false, hasLocalTrack: true, now }),
    "local",
  );
  assert.equal(
    castResumeTarget({ usingRemote: false, hasLocalTrack: false, now }),
    null,
  );
});
