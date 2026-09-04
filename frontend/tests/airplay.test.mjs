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

test("投屏视频在打开设备选择器之前必须：看得见、不静音、已经在播", async () => {
  /*
   * 三条都不是可有可无的。缺任何一条，Safari 就会把 AirPlay 路由绑到
   * 音频 / Now Playing 会话上，电视上显示的是"封面 + 歌名"的标准音频
   * 投屏画面，而不是我们的歌词页 —— 用户拍照实证过一次。
   *
   * **不静音**这条尤其反直觉：服务端刻意给这条流配了一条静音 AAC 轨
   * （audioMode = dual-clock-silent-aac，实测 mean_volume -91.0 dB），
   * 目的就是让 WebKit 认它是一个完整的音视频会话、有资格拿走路由。
   * 元素上再加 `muted` 正好把这条轨的作用抵消掉 —— 那是遗留的错。
   */
  const calls = [];
  const video = {
    classList: { add: (name) => calls.push(`class:${name}`) },
    style: {},
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
  assert.equal(video.muted, false, "静音会让 WebKit 把路由绑到音频会话");
  assert.equal(video.defaultMuted, false);
  assert.equal(video.volume, 1);
  assert.equal(video.preload, "auto");
  // 看得见：不能只靠 CSS 类，行内样式一起写死，免得哪一层又把它藏了
  assert.equal(video.style.visibility, "visible");
  assert.equal(video.style.opacity, "1");
  assert.deepEqual(calls, ["class:is-active", "load", "play"]);
});

test("不静音被自动播放策略拒掉时，退回静音而不是彻底失败", async () => {
  /* 真机上验不了自动播放策略，所以设计成降级：
     万一"不静音"这个判断是错的，最差也只是退回改之前的行为。 */
  let attempts = 0;
  const video = {
    classList: { add() {} },
    style: {},
    currentSrc: "",
    src: "",
    load() {},
    play() {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("NotAllowedError"));
      return Promise.resolve();
    },
  };
  await primeAirPlayVideo(video, "http://nas.local/cast/master.m3u8");
  assert.equal(attempts, 2, "第一次被拒之后应该静音重试一次");
  assert.equal(video.muted, true, "退回静音才可能放得出来");
});

test("两次都放不出来时把原始错误抛出去，别静默吞掉", async () => {
  const video = {
    classList: { add() {} },
    style: {},
    currentSrc: "",
    src: "",
    load() {},
    play: () => Promise.reject(new Error("NotAllowedError")),
  };
  await assert.rejects(
    () => primeAirPlayVideo(video, "http://nas.local/cast/master.m3u8"),
    /NotAllowedError/,
  );
});

test("airPlayVideoIsLive 只在真的有画面在走时才算数", async () => {
  const { airPlayVideoIsLive } = await import("../src/lib/airplay.js");
  assert.equal(airPlayVideoIsLive(null), false);
  assert.equal(
    airPlayVideoIsLive({ paused: true, ended: false, readyState: 4, videoWidth: 1920 }),
    false,
    "暂停的不算",
  );
  assert.equal(
    airPlayVideoIsLive({ paused: false, ended: false, readyState: 0, videoWidth: 0 }),
    false,
    "还没解出第一帧的不算 —— 那正是绑错路由的时刻",
  );
  assert.equal(
    airPlayVideoIsLive({ paused: false, ended: false, readyState: 3, videoWidth: 1920 }),
    true,
  );
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
