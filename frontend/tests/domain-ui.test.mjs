import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  pathForSettingsTab,
  playlistIdFromPath,
  settingsTabFromPath,
} from "../src/lib/routes.js";
import {
  mobileMoreTarget,
  mobileNavigationIds,
  mobileNavigationTarget,
} from "../src/lib/navigation.js";
import {
  mergeCatalogResults,
  sourceCatalogReady,
} from "../src/lib/sources.js";
import { pwaInstallGuidance, pwaSecureOrigin } from "../src/lib/pwa.js";
import { buildAmbientDeck } from "../src/lib/ambient.js";
import {
  appearanceStyle,
  normalizeAppearance,
  resolvedTheme,
} from "../src/lib/appearance.js";
import { clearFastCache, readFastCache, writeFastCache } from "../src/lib/cache.js";

/** 读取 src 下的单个源文件。 */
const readSource = (relativePath) =>
  readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");

/**
 * 把 src 下所有源文件拼起来。
 * "整个前端都不应该出现某个东西"这类断言要扫全树，
 * 否则代码一搬家断言就悄悄失效了。
 */
const readAllSources = () => {
  const root = new URL("../src/", import.meta.url);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) return walk(child);
      return /\.(jsx?|mjs)$/.test(entry.name) ? [readFileSync(child, "utf8")] : [];
    });
  return walk(root).join("\n");
};

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
  assert.equal(pageFromPath("/settings/users"), "settings");
  assert.equal(settingsTabFromPath("/settings/users"), "user");
  assert.equal(pathForSettingsTab("logs"), "/settings/system");
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

test("手机底栏放得下的四个听歌目的地，加一个通往其余全部的入口", () => {
  // 五格是拇指能舒服覆盖的上限。四个听歌目的地 + 一个"更多"。
  assert.deepEqual(mobileNavigationIds, [
    "home",
    "library",
    "player",
    "playlists",
    "more",
  ]);

  // "更多"必须真的通往某处 —— 桌面侧栏改版时这里漏掉过：
  // nav 数组里删掉了 manage，底栏按 id 查不到就把整格过滤没了，
  // 手机上所有整理工具直接不可达。
  assert.equal(mobileMoreTarget(true), "manage");
  // 普通听众没有整理权限，直接落到设置，不让他们先撞一次"无权限"。
  assert.equal(mobileMoreTarget(false), "settings");

  // 子页面各自归到对应的格子。
  assert.equal(mobileNavigationTarget("discover"), "home");
  assert.equal(mobileNavigationTarget("me"), "library");
  assert.equal(mobileNavigationTarget("search"), "library");
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

test("all-platform search keeps QQ and NetEase results while removing true duplicates", () => {
  const items = mergeCatalogResults([
    { platform: "tx", trackId: "1", title: "夜曲" },
    { platform: "wy", trackId: "1", title: "夜曲" },
    { platform: "tx", trackId: "1", title: "夜曲（重复）" },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.platform), ["tx", "wy"]);
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
      hasPrompt: false,
      secureOrigin: false,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    }).actionLabel,
    "查看添加方法",
  );
  assert.match(
    pwaInstallGuidance({
      hasPrompt: false,
      secureOrigin: false,
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)",
    }).summary,
    /仍可添加到主屏幕并正常登录/,
  );
  assert.equal(
    pwaInstallGuidance({
      hasPrompt: false,
      secureOrigin: false,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }).actionLabel,
    "查看添加方法",
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

test("手机底栏任何时刻只有一格高亮", () => {
  // 重构前这里会同时高亮"播放""工具""设置"三格 ——
  // 三个判断各自独立返回 true。现在函数只有一个出口，逐条 return。
  const toolIds = ["local", "scrape", "download", "sources", "tasks"];
  const pages = [
    "home",
    "library",
    "player",
    "playlists",
    "discover",
    "me",
    "search",
    "manage",
    "settings",
    ...toolIds,
  ];

  for (const page of pages) {
    const target = mobileNavigationTarget(page, toolIds);
    // 结果必须是底栏真实存在的五格之一，否则那一页会一格都不亮。
    assert.ok(
      mobileNavigationIds.includes(target),
      `${page} 高亮到了 ${target}，不是底栏里的格子`,
    );
  }

  // 整理曲库下的每一页，以及设置，都归到"更多"这一格。
  for (const page of [...toolIds, "manage", "settings"]) {
    assert.equal(mobileNavigationTarget(page, toolIds), "more");
  }

  // 旧样式里用 nth-child(3) 硬指第三格，一旦格子数量变化就会指错。
  const shellCss = readFileSync(
    new URL("../src/features/shell/shell-refactor.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(shellCss, /mobile-nav button:nth-child\(3\)/);
});

test("登录页保留氛围与分栏，但当初那些缺陷不能回来", () => {
  const login = readSource("features/auth/Login.jsx");
  // 注释里会引用旧文案说明改掉了什么，断言前先剥掉，否则会误命中。
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const styles = stripComments(readSource("features/auth/login.css"));
  const loginCode = stripComments(login);

  // 左右分栏是刻意保留的 —— 它让人一进来就知道这是什么产品。
  assert.match(styles, /\.login__grid\s*\{[\s\S]*?grid-template-columns/);
  // 但窄屏必须有单列回退。旧版没有，只能靠一段 !important 把表单拽回首屏。
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(styles, /!important/);

  // 旧版左上角 logo 用绝对定位，压在标题和上方小字上。
  // 现在 logo 在左栏文档流里，样式表里不该再出现给它的绝对定位。
  assert.doesNotMatch(styles, /\.login__brand\s*\{[^}]*position:\s*absolute/);

  // 英文装饰、"控制台"口吻、企业 SSO 都不该回来。
  assert.doesNotMatch(loginCode, /YOUR MUSIC|SECURE ACCESS|PRIVATE MUSIC/);
  assert.doesNotMatch(loginCode, /控制台/);
  assert.doesNotMatch(loginCode, /SSO|单点登录/);

  // 品牌名整页只出现一次（旧版出现三次）。
  assert.equal((loginCode.match(/BRAND\.cnName/g) || []).length, 1);

  // 启动兜底屏仍然要在。
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(indexHtml, /#root:empty::before/);
  assert.match(indexHtml, /正在连接本地音乐库/);
});

test("登录页背景视频不能把当初的 iPad 启动问题带回来", () => {
  const backdrop = readSource("components/ui/VideoBackdrop.jsx");
  const login = readSource("features/auth/Login.jsx");
  const styles = readSource("features/auth/login.css");

  // 1.0.4 移除背景视频的原因是原文件 11.7 MB、码率 9.7 Mbps，
  // 在低性能 iPad 上和前端初始化抢资源。视频可以回来，
  // 但下面这四道闸必须在，否则等于把那个问题重新引入。
  assert.match(backdrop, /prefers-reduced-motion/); // 尊重减弱动效
  assert.match(backdrop, /saveData/); // 尊重省流量
  assert.match(backdrop, /requestIdleCallback/); // 空闲才加载，不阻塞首屏
  assert.match(backdrop, /visibilitychange/); // 切到后台就暂停解码
  assert.match(backdrop, /preload="none"/);

  // 海报图是必需的兜底：任何一道闸没过，背景仍然成立。
  assert.match(login, /poster="\/visuals\/login-island\.jpg"/);

  // 不得再引用未压缩的原始素材。
  assert.doesNotMatch(readAllSources(), /songlib-login-background\.mp4/);

  // 源视频有一处水印沿画面四周游走，靠遮罩把外圈淡出来遮住。
  // 遮罩没了水印就会露出来，所以锁住它。
  assert.match(styles, /mask-image:[\s\S]*?radial-gradient/);
  assert.match(styles, /mask-composite/);
});

test("touch startup and the global shell avoid continuous media work", () => {
  // 这两条是"整个前端都不该出现"，扫全树而不是只看单个文件。
  const allSources = readAllSources();
  assert.doesNotMatch(allSources, /from ["']motion\/react["']/);
  assert.doesNotMatch(allSources, /songlib-login-background\.mp4/);

  const player = readSource("features/player/PlayerProvider.jsx");
  assert.match(player, /const PlayerClockContext = createContext/);
  assert.match(player, /<PlayerClockContext\.Provider value=\{clock\}>/);

  const shell = readSource("app/AuthenticatedShell.jsx");
  assert.match(shell, /function AuthenticatedShell[\s\S]*?const player = usePlayerCore\(\)/);
});

test("startup cannot remain on the static connecting screen forever", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const startup = readFileSync(
    new URL("../public/startup-v105.js", import.meta.url),
    "utf8",
  );
  const entry = readSource("main.jsx");
  assert.match(index, /startup-v105\.js/);
  assert.match(startup, /window\.setTimeout\(recoverOnce, 12000\)/);
  assert.match(startup, /清理本应用缓存并重新连接/);
  assert.match(startup, /registration\.unregister\(\)/);
  assert.match(entry, /dataset\.songlibStarted = BRAND\.version/);
  assert.match(entry, /new Event\("songlib:started"\)/);
  assert.match(readSource("lib/api.js"), /timeoutMs = 20000/);
  assert.match(
    readSource("app/App.jsx"),
    /api\("\/api\/auth\/status", \{ timeoutMs: 8000 \}\)/,
  );
});

test("logged-in player chrome defines the time formatter it renders", () => {
  // formatTime 现在是 lib/format.js 里的共享工具，两个播放器组件从那里导入。
  assert.match(readSource("lib/format.js"), /const formatTime = \(value\) => \{/);
  const sidebarPlayer = readSource("features/shell/SidebarMiniPlayer.jsx");
  assert.match(sidebarPlayer, /import \{[^}]*formatTime[^}]*\} from "\.\.\/\.\.\/lib\/format"/);
  assert.match(
    sidebarPlayer,
    /function SidebarMiniPlayer[\s\S]*?formatTime\(player\.currentTime\)/,
  );
  const miniPlayer = readSource("features/player/MiniPlayer.jsx");
  assert.match(miniPlayer, /import \{[^}]*formatTime[^}]*\} from "\.\.\/\.\.\/lib\/format"/);
  assert.match(miniPlayer, /function MiniPlayer[\s\S]*?formatTime\(player\.duration\)/);
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
