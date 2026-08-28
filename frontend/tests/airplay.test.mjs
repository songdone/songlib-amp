import test from "node:test";
import assert from "node:assert/strict";

import {
  airPlayLiveLatencyMs,
  airPlayStatePayload,
  airPlayTrackId,
  nativeAirPlayAvailable,
  primeAirPlayVideo,
} from "../src/lib/airplay.js";
import { parseLrc } from "../src/lib/lyrics.js";

test("native AirPlay support is capability-detected from the video element", () => {
  assert.equal(nativeAirPlayAvailable(null), false);
  assert.equal(nativeAirPlayAvailable({}), false);
  assert.equal(nativeAirPlayAvailable({ webkitShowPlaybackTargetPicker() {} }), true);
});

test("AirPlay video is visible, muted and already playing before the native picker", async () => {
  const calls = [];
  const video = {
    classList: { add: (name) => calls.push(`class:${name}`) },
    currentSrc: "",
    src: "",
    load: () => calls.push("load"),
    play: () => {
      calls.push("play");
      return Promise.resolve();
    },
  };
  await primeAirPlayVideo(video, "http://nas.local/cast/master.m3u8");
  assert.equal(video.src, "http://nas.local/cast/master.m3u8");
  assert.equal(video.defaultMuted, true);
  assert.equal(video.muted, true);
  assert.equal(video.preload, "auto");
  assert.deepEqual(calls, ["class:is-active", "load", "play"]);
});

test("cast state uses stable source identity and the browser media clock", () => {
  const track = {
    sourceType: "local_file",
    localFileId: "42",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    coverUrl: "/api/cover/42",
  };
  assert.equal(airPlayTrackId(track), "local_file:42");
  assert.deepEqual(
    airPlayStatePayload({
      track,
      lyrics: "[00:01.00]故事的小黄花",
      player: { currentTime: 12.5, duration: 269, isPlaying: true, quality: "original" },
    }),
    {
      trackId: "local_file:42",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      quality: "original",
      lyrics: "[00:01.00]故事的小黄花",
      position: 12.5,
      duration: 269,
      playing: true,
      sourceType: "local_file",
      localFileId: "42",
      plexRatingKey: "",
      coverKey: "/api/cover/42",
      lyricsOffsetMs: 0,
      transportLatencyMs: 0,
    },
  );
  assert.equal(
    airPlayStatePayload({ track, player: {}, lyricsOffsetMs: 9000 }).lyricsOffsetMs,
    5000,
  );
});

test("cast latency follows the AirPlay live edge and stays bounded", () => {
  assert.equal(
    airPlayLiveLatencyMs({
      currentTime: 10,
      seekable: { length: 1, end: () => 12.42 },
    }),
    2400,
  );
  assert.equal(
    airPlayLiveLatencyMs({
      currentTime: 0,
      seekable: { length: 1, end: () => 20 },
    }),
    5000,
  );
  assert.equal(airPlayLiveLatencyMs({ seekable: { length: 0 } }), 0);
});

test("enhanced LRC keeps word timing without exposing timing tags", () => {
  const lines = parseLrc(
    "[00:19.00]<00:19.00>逐<00:19.35>字<00:19.70>歌<00:20.05>词",
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "逐字歌词");
  assert.deepEqual(lines[0].words, [
    { time: 19, text: "逐" },
    { time: 19.35, text: "字" },
    { time: 19.7, text: "歌" },
    { time: 20.05, text: "词" },
  ]);
});
