/**
 * 一次性 codemod：把 9,163 行的 main.jsx 按 feature 拆成模块。
 *
 * 拆分依据是 scripts/analyze-main.mjs 输出的依赖图（一个无环 DAG）。
 * 脚本负责三件容易手写出错的事：
 *   1. 按行范围搬运顶层声明，不改动函数体本身；
 *   2. 扫描每个模块用到的标识符，自动生成 import（React hook、lucide 图标、
 *      lib/* 工具、以及拆出来的兄弟模块），并算好相对路径深度；
 *   3. 把被别的模块引用到的声明标成 export。
 *
 * 用法：node scripts/split-main.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");
const mainFile = path.join(srcDir, "main.jsx");
const dryRun = process.argv.includes("--dry-run");

/* ---------------------------------------------------------------------------
 * 模块划分。顺序无关紧要，依赖由脚本自己算。
 * 分组原则：按用户任务（feature）而不是技术类型，与 docs/UX-RESTRUCTURE.md
 * 里的一级导航对齐；跨 feature 复用的放 components / lib。
 * ------------------------------------------------------------------------- */
const PLAN = [
  // --- 纯函数工具 ---
  { file: "lib/format.js", decls: ["fmt", "pct", "formatTime", "durationLabel", "timeAgo"] },
  {
    file: "lib/media.js",
    decls: [
      "VISUAL_FALLBACKS",
      "coverUrlFor",
      "normalizeTrackTitle",
      "trackIdentity",
      "isPlayableDuration",
      "sanitizeQueue",
      "persistableTrack",
    ],
  },
  { file: "lib/storage.js", decls: ["storedJson"] },
  { file: "lib/permissions.js", decls: ["userIsAdmin"] },
  { file: "lib/nav-model.js", decls: ["nav", "managementNav", "activeNavId", "pageMeta"] },

  // --- 跨 feature 复用的 hook 与展示组件 ---
  { file: "hooks/useMediaQuery.js", decls: ["useMediaQuery"] },
  { file: "components/Brand.jsx", decls: ["Brand"] },
  {
    file: "components/Backdrops.jsx",
    decls: ["AppBackdrop", "ArtistBackdrop", "PlayerBackdrop", "LoginMotionBackdrop"],
  },
  { file: "components/Spectrum.jsx", decls: ["Spectrum"] },
  { file: "components/StatCard.jsx", decls: ["StatCard"] },
  { file: "components/SectionHead.jsx", decls: ["SectionHead"] },
  { file: "components/Empty.jsx", decls: ["Empty"] },
  { file: "components/PageLoader.jsx", decls: ["PageLoader"] },
  { file: "components/Toast.jsx", decls: ["Toast"] },
  { file: "components/SettingBlock.jsx", decls: ["SettingBlock"] },
  { file: "components/PwaInstallPrompt.jsx", decls: ["PwaInstallPrompt"] },
  { file: "components/MediaCard.jsx", decls: ["MediaCard"] },
  { file: "components/TrackTable.jsx", decls: ["TrackTable"] },
  { file: "components/JobRow.jsx", decls: ["JobRow"] },

  // --- feature：登录与首装 ---
  { file: "features/auth/Login.jsx", decls: ["LoginFeatureCard", "Login"] },
  { file: "features/auth/SetupWizard.jsx", decls: ["SetupWizard"] },

  // --- feature：播放核心 ---
  {
    file: "features/player/PlayerProvider.jsx",
    decls: [
      "PlayerContext",
      "PlayerClockContext",
      "usePlayerCore",
      "usePlayer",
      "sourceLabel",
      "immediatePlaybackTrack",
      "toPlaybackTrack",
      "PlayerProvider",
    ],
  },
  { file: "features/player/MiniPlayer.jsx", decls: ["MiniPlayer"] },

  // --- feature：外壳导航 ---
  { file: "features/shell/SidebarMiniPlayer.jsx", decls: ["SidebarMiniPlayer"] },
  { file: "features/shell/Sidebar.jsx", decls: ["Sidebar"] },
  { file: "features/shell/Topbar.jsx", decls: ["Topbar"] },
  { file: "features/shell/MobileNav.jsx", decls: ["MobileNav"] },

  // --- feature：各个页面 ---
  { file: "features/dashboard/Dashboard.jsx", decls: ["Dashboard"] },
  { file: "features/library/MediaLibrary.jsx", decls: ["MediaLibrary"] },
  { file: "features/library/LibraryDetailPage.jsx", decls: ["LibraryDetailPage"] },
  { file: "features/library/LocalLibraryPage.jsx", decls: ["LocalLibraryPage"] },
  { file: "features/discover/DiscoverPage.jsx", decls: ["DiscoverPage"] },
  { file: "features/discover/RecommendationPage.jsx", decls: ["RecommendationPage"] },
  { file: "features/search/GlobalSearchPage.jsx", decls: ["GlobalSearchPage"] },
  { file: "features/playlists/PlaylistsPage.jsx", decls: ["PlaylistsPage"] },
  { file: "features/me/MePage.jsx", decls: ["MePage"] },

  // --- feature：音乐工具 ---
  { file: "features/tools/ScrapeCenter.jsx", decls: ["scrapeTabs", "ScrapeCenter"] },
  { file: "features/tools/SourceManager.jsx", decls: ["SOURCE_STATES", "SourceManager"] },
  { file: "features/tools/DownloadInboxPanel.jsx", decls: ["DownloadInboxPanel"] },
  { file: "features/tools/DownloadCenter.jsx", decls: ["DownloadCenter"] },
  { file: "features/tools/Tasks.jsx", decls: ["Tasks"] },
  { file: "features/tools/ManagementHub.jsx", decls: ["ManagementHub"] },

  // --- feature：设置 ---
  { file: "features/settings/PlexSettingsModal.jsx", decls: ["PlexSettingsModal"] },
  { file: "features/settings/UserAccounts.jsx", decls: ["UserAccounts"] },
  {
    file: "features/settings/SettingsPage.jsx",
    decls: ["ADMIN_SETTINGS_TAB_IDS", "LISTENER_SETTINGS_TAB_IDS", "SettingsPage"],
  },

  // --- 应用装配 ---
  { file: "app/NowPlayingRoute.jsx", decls: ["NowPlayingRoute"] },
  { file: "app/AuthenticatedShell.jsx", decls: ["AuthenticatedShell"] },
  { file: "app/App.jsx", decls: ["App"] },
];

/* ---------------------------------------------------------------------------
 * 解析 main.jsx
 * ------------------------------------------------------------------------- */
const source = fs.readFileSync(mainFile, "utf8");
const lines = source.split("\n");

/** 原始 import：符号 -> 模块路径。用来给拆出来的文件重建 import。 */
const externalImports = new Map();
const importBlockPattern = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?$/gm;
let importMatch;
while ((importMatch = importBlockPattern.exec(source))) {
  const clause = importMatch[1].trim();
  const from = importMatch[2];
  const namedPart = clause.match(/\{([\s\S]*)\}/);
  if (namedPart) {
    for (const raw of namedPart[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) externalImports.set(name, { from, kind: "named" });
    }
  }
  const defaultPart = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
  if (defaultPart) externalImports.set(defaultPart, { from, kind: "default" });
}

/** 顶层声明及其行范围。 */
const declPattern =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\s+([A-Za-z0-9_$]+)|(?:const|let|var|class)\s+([A-Za-z0-9_$]+))/;
const decls = [];
lines.forEach((line, index) => {
  const match = line.match(declPattern);
  if (!match) return;
  const name = match[2] || match[3];
  if (name) decls.push({ name, start: index + 1 });
});
decls.forEach((decl, index) => {
  decl.end = index + 1 < decls.length ? decls[index + 1].start - 1 : lines.length;
});

const declByName = new Map(decls.map((d) => [d.name, d]));

/**
 * main.jsx 末尾的挂载代码要留在入口里，不能跟着 MobileNav 被搬走。
 * 用 createRoot 调用作为分界。
 */
const bootstrapStart = lines.findIndex((line) => line.startsWith("createRoot("));
if (bootstrapStart >= 0) {
  const last = decls[decls.length - 1];
  if (last.end > bootstrapStart) last.end = bootstrapStart;
}

const bodyOf = (name) => {
  const decl = declByName.get(name);
  if (!decl) throw new Error(`main.jsx 里找不到声明：${name}`);
  return lines.slice(decl.start - 1, decl.end).join("\n").trimEnd();
};

/* ---------------------------------------------------------------------------
 * 建立 声明 -> 目标模块 的索引，并算出每个模块要 export 什么
 * ------------------------------------------------------------------------- */
const moduleOf = new Map();
for (const mod of PLAN) {
  for (const name of mod.decls) {
    if (moduleOf.has(name)) throw new Error(`${name} 被分配到了多个模块`);
    moduleOf.set(name, mod.file);
  }
}

const planned = new Set(moduleOf.keys());
const missing = decls.map((d) => d.name).filter((n) => !planned.has(n));
if (missing.length) throw new Error(`以下声明没有归属模块：${missing.join(", ")}`);

/** 在一段代码里，哪些候选标识符被引用了。 */
const referenced = (code, candidates) => {
  const hits = new Set();
  for (const name of candidates) {
    const pattern = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
    if (pattern.test(code)) hits.add(name);
  }
  return hits;
};

// 每个模块的代码体，用于计算跨模块引用。
const moduleBodies = new Map();
for (const mod of PLAN) {
  moduleBodies.set(mod.file, mod.decls.map(bodyOf).join("\n\n"));
}

// 需要 export 的声明 = 被其他模块引用到的。
const exported = new Set();
for (const mod of PLAN) {
  const own = new Set(mod.decls);
  const body = moduleBodies.get(mod.file);
  for (const name of planned) {
    if (own.has(name)) continue;
    if (new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body)) exported.add(name);
  }
}
// 入口仍然要用 App。
exported.add("App");

/* ---------------------------------------------------------------------------
 * 生成文件
 * ------------------------------------------------------------------------- */
const relativeImport = (fromFile, toFile) => {
  const fromDir = path.dirname(path.join(srcDir, fromFile));
  const target = path.join(srcDir, toFile);
  let rel = path.relative(fromDir, target).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.replace(/\.(jsx|js)$/, "");
};

/** 把 from -> 符号集合 整理成 import 语句。 */
const renderImports = (groups) => {
  const statements = [];
  for (const [from, spec] of groups) {
    const parts = [];
    if (spec.default) parts.push(spec.default);
    if (spec.named.size) parts.push(`{ ${[...spec.named].sort().join(", ")} }`);
    if (!parts.length) continue;
    statements.push(`import ${parts.join(", ")} from "${from}";`);
  }
  return statements;
};

const externalNames = [...externalImports.keys()];
const written = [];

for (const mod of PLAN) {
  const own = new Set(mod.decls);
  const bodies = mod.decls.map((name) => {
    const body = bodyOf(name);
    return exported.has(name) ? `export ${body}` : body;
  });
  const code = bodies.join("\n\n");

  /** 按来源归组：外部依赖 + 兄弟模块。 */
  const groups = new Map();
  const addNamed = (from, name) => {
    if (!groups.has(from)) groups.set(from, { default: null, named: new Set() });
    groups.get(from).named.add(name);
  };
  const addDefault = (from, name) => {
    if (!groups.has(from)) groups.set(from, { default: null, named: new Set() });
    groups.get(from).default = name;
  };

  for (const name of referenced(code, externalNames)) {
    const info = externalImports.get(name);
    // React 默认导出只在代码里真的写了 React. 的时候才需要。
    if (name === "React" && !/\bReact\./.test(code)) continue;
    // 原来的相对路径是相对 src/main.jsx 写的，新模块在不同深度，要重算。
    const from = info.from.startsWith(".")
      ? relativeImport(mod.file, info.from.replace(/^\.\//, ""))
      : info.from;
    if (info.kind === "default") addDefault(from, name);
    else addNamed(from, name);
  }

  for (const name of referenced(code, [...planned])) {
    if (own.has(name)) continue;
    const target = moduleOf.get(name);
    addNamed(relativeImport(mod.file, target), name);
  }

  const header = renderImports(
    [...groups.entries()].sort(([a], [b]) => {
      const rank = (p) => (p.startsWith(".") ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    }),
  );

  const contents = `${header.join("\n")}\n\n${code}\n`;
  const outPath = path.join(srcDir, mod.file);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, contents, "utf8");
  }
  written.push(`${mod.file}  (${code.split("\n").length} 行, ${header.length} 条 import)`);
}

/* ---------------------------------------------------------------------------
 * 重写 main.jsx 为一个薄入口
 * ------------------------------------------------------------------------- */
const bootstrap = bootstrapStart >= 0 ? lines.slice(bootstrapStart).join("\n").trimEnd() : "";

// Service Worker 注册块：从它自己那一行，到第一个顶层声明之前。
// 按行号切，不按字符串匹配 —— 声明可能是 const 也可能是 function。
const swStart = lines.findIndex((line) =>
  line.startsWith('if (window.isSecureContext && "serviceWorker" in navigator)'),
);
const serviceWorkerBlock =
  swStart >= 0 ? lines.slice(swStart, decls[0].start - 1).join("\n").trimEnd() : "";

const entry = `/**
 * 应用入口。这里只做三件事：注册 Service Worker、挂载 React 根、
 * 广播启动完成事件。任何界面逻辑都不应该回到这个文件。
 *
 * 组件按 feature 分布在 src/features/，跨 feature 复用的在 src/components/，
 * 纯函数在 src/lib/。
 */
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { BRAND } from "./config/brand";
import { App } from "./app/App";

${serviceWorkerBlock.trim()}

${bootstrap}
`;

if (!dryRun) fs.writeFileSync(mainFile, entry, "utf8");

console.log(written.join("\n"));
console.log(
  `\n${dryRun ? "[试运行] " : ""}拆出 ${PLAN.length} 个模块，main.jsx 从 ${lines.length} 行缩到 ${entry.split("\n").length} 行。`,
);
console.log(`需要导出的声明 ${exported.size} 个。`);
