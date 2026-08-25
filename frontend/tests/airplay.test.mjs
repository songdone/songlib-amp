import test from "node:test";
import assert from "node:assert/strict";

import {
  airPlayStatePayload,
  airPlayTrackId,
  nativeAirPlayAvailable,
} from "../src/lib/airplay.js";

test("native AirPlay support is capability-detected from the video element", () => {
  assert.equal(nativeAirPlayAvailable(null), false);
  assert.equal(nativeAirPlayAvailable({}), false);
  assert.equal(nativeAirPlayAvailable({ webkitShowPlaybackTargetPicker() {} }), true);
});

test("cast state uses stable source identity and the browser media clock", () => {
  const track = {
    sourceType: "local_file",
    localFileId: "42",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
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
    },
  );
});
