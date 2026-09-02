/**
 * 离线曲库索引。
 *
 * IndexedDB 那层在 Node 里跑不了，但真正会出错的不是存取，
 * 是归一化和排序：离线搜索没有服务端的相关度排序，
 * "标题就叫这个"和"专辑名里碰巧含这两个字"全靠这里分开。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeQuery,
  rankEntries,
  scoreEntry,
  toEntry,
} from "../src/lib/offlineIndex.js";

/* =================================================================
 * 归一化
 * ================================================================= */

test("归一化去掉空白、全角标点和大小写差异", () => {
  assert.equal(normalizeQuery("海阔天空（Live）"), "海阔天空live");
  assert.equal(normalizeQuery("海阔天空 Live"), "海阔天空live");
  assert.equal(normalizeQuery("  Bohemian  Rhapsody  "), "bohemianrhapsody");
});

test("归一化让不同写法能互相搜到", () => {
  // 这是这个函数存在的理由：用户不会按曲名里的括号样式打字。
  const written = normalizeQuery("我们的爱 - Album Version");
  assert.equal(written, normalizeQuery("我们的爱albumversion"));
  assert.equal(written, normalizeQuery("我们的爱 Album Version"));
});

test("归一化空值不抛", () => {
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(normalizeQuery(value), "");
  }
});

/* =================================================================
 * 打分
 * ================================================================= */

const entry = (title, subtitle = "") => ({
  title,
  subtitle,
  searchTitle: normalizeQuery(title),
  searchSubtitle: normalizeQuery(subtitle),
});

test("标题完全相同得分最高，副标题里含到得分最低", () => {
  const needle = normalizeQuery("海阔天空");
  const exact = scoreEntry(entry("海阔天空"), needle);
  const prefix = scoreEntry(entry("海阔天空 Live"), needle);
  const contains = scoreEntry(entry("翻唱海阔天空"), needle);
  const subtitle = scoreEntry(entry("别的歌", "专辑：海阔天空"), needle);
  assert.ok(
    exact > prefix && prefix > contains && contains > subtitle && subtitle > 0,
    `分档不对：${[exact, prefix, contains, subtitle].join(" > ")}`,
  );
});

test("搜不到就是 0，不是一个很小的分", () => {
  assert.equal(scoreEntry(entry("晴天", "周杰伦"), normalizeQuery("海阔天空")), 0);
});

test("空检索词不匹配任何东西", () => {
  assert.equal(scoreEntry(entry("晴天"), ""), 0);
});

/* =================================================================
 * 排序
 * ================================================================= */

test("排序把完全命中的排在前面", () => {
  const entries = [
    entry("翻唱海阔天空", "某歌手"),
    entry("海阔天空", "Beyond"),
    entry("海阔天空 Live", "Beyond"),
  ];
  const ranked = rankEntries(entries, "海阔天空");
  assert.deepEqual(
    ranked.map((item) => item.title),
    ["海阔天空", "海阔天空 Live", "翻唱海阔天空"],
  );
});

test("同分时短标题在前", () => {
  const entries = [entry("晴天的日子里很好"), entry("晴天")];
  const ranked = rankEntries(entries, "晴天");
  assert.equal(ranked[0].title, "晴天", "用户搜「晴天」多半是要那首叫晴天的");
});

test("空检索词返回空数组，不是全部条目", () => {
  const entries = [entry("晴天"), entry("勇气")];
  assert.deepEqual(rankEntries(entries, ""), []);
  assert.deepEqual(rankEntries(entries, "   "), []);
});

test("limit 生效", () => {
  const entries = Array.from({ length: 50 }, (_, index) =>
    entry(`晴天 ${index}`),
  );
  assert.equal(rankEntries(entries, "晴天", 10).length, 10);
});

/* =================================================================
 * 压成索引项
 * ================================================================= */

test("索引项只保留检索、展示和重新起播需要的字段", () => {
  const result = toEntry("track", {
    id: "file-1",
    title: "海阔天空",
    artist: "Beyond",
    album: "乐与怒",
    duration: 313000,
    thumbUrl: "/cover.jpg",
    // 这些一离线就作废，不该进索引
    audioUrl: "http://nas:8000/stream/xxx",
    transcodeUrls: { "320k": "http://nas:8000/t/320" },
    raw: { huge: "x".repeat(5000) },
  });
  assert.equal(result.title, "海阔天空");
  assert.equal(result.subtitle, "Beyond · 乐与怒");
  assert.equal(result.kind, "track");
  assert.equal(result.coverUrl, "/cover.jpg");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("audioUrl"), "audioUrl 不该被存下来");
  assert.ok(!serialized.includes("transcodeUrls"), "transcodeUrls 不该被存下来");
  assert.ok(!serialized.includes("huge"), "raw 不该被存下来");
  assert.ok(serialized.length < 400, `一条 ${serialized.length} 字节，太大了`);
});

test("key 带 kind 前缀，不同来源不会互相覆盖", () => {
  const track = toEntry("track", { ratingKey: "100", title: "晴天" });
  const album = toEntry("album", { ratingKey: "100", title: "叶惠美" });
  assert.notEqual(track.key, album.key, "歌和专辑的 ratingKey 可能撞号");
  assert.ok(track.key.startsWith("track:"));
  assert.ok(album.key.startsWith("album:"));
});

test("Plex 的字段名（grandparentTitle / parentTitle）也认", () => {
  const result = toEntry("track", {
    ratingKey: "1",
    title: "晴天",
    grandparentTitle: "周杰伦",
    parentTitle: "叶惠美",
  });
  assert.equal(result.subtitle, "周杰伦 · 叶惠美");
});

test("只有文件名的本地文件也能进索引", () => {
  const result = toEntry("track", {
    id: "f1",
    filename: "03 - 晴天.flac",
    path: "/music/周杰伦/叶惠美/03 - 晴天.flac",
  });
  assert.equal(result.title, "03 - 晴天.flac");
  assert.equal(result.payload.path, "/music/周杰伦/叶惠美/03 - 晴天.flac");
});
