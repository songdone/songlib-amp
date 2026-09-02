/**
 * 删掉旧样式表里永远不可能匹配的规则。
 *
 * 判据只有一条，很硬：一个选择器里如果出现了任何一个在全部
 * JS/JSX 源码里都找不到的类名，这个选择器就永远匹配不到元素。
 * 逗号分隔的选择器逐个判断 —— 一条规则里可能有的还活着，
 * 那就只删死掉的那几个，保留规则本体。
 *
 * 为什么不解析 className 属性：
 * 有些类名是拼出来的（`${kind}-card`、模板串、数组 join），也有些是
 * 组件内部拼好再返回的（Button 里的 "ui-btn"、buttonClass()），
 * 解析属性会漏。所以从**所有字符串字面量**里取词。
 *
 * 词是怎么取的 —— 这一步踩过两次坑，都值得写下来：
 *
 * 第一版：`blob.includes(cls)`，裸子串搜索。两类假阴性：
 *   .panel   ← "account-panel" 里含 "panel"，判活
 *   .primary ← variant="primary" 是组件枚举值不是类名，判活
 * 结果是明明死掉的规则一直留在包里。
 *
 * 第二版：正则 /(['"`])(...)\1/ 抓字符串字面量再切词。看着对，
 * 实际全错 —— 把所有文件拼成一个大串之后，任何一处不成对的引号
 * （JSX 正文里的 don't、注释里的引号、正则里的引号）都会让之后的
 * 配对整体错位。验证时 ui-btn、mini-player、now-notice 全部判死，
 * 报告说要删 884 条规则、now-playing.css 从 1403 行砍到 48 行。
 * 那一步要是直接 --apply 就把还在用的样式全删了。
 *
 * 第三版（现在）：同样是正则，但**逐行**分词。错位最多毁掉它自己
 * 那一行，不会跨文件传染。另外加了金丝雀自检：几个"一定活着"的
 * 类名如果被判死，脚本直接退出，不给出报告。
 *
 * （本来想用 TypeScript 的解析器，但这个仓库的 typescript 是 7.0.2
 * 的 Go 重写版，ESM 和 CJS 都只导出 version，没有 createSourceFile。）
 *
 * 加 --list 会打印它认为死掉的类名，删之前该看一眼。
 *
 * 不动的东西：
 *   @keyframes 的内容（里面的百分比不是选择器）
 *   不含类名的选择器（:root、html、body、元素选择器、属性选择器）
 *   自定义属性定义
 *
 * 用法：node scripts/prune-dead-legacy.mjs [--apply]
 * 不加 --apply 只报告。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;

const LEGACY = [
  "styles.css",
  "commercial.css",
  "liquid-glass.css",
  "features/now-playing/now-playing.css",
  "features/shell/shell-refactor.css",
  "styles/legacy-protected.css",
];

/** 递归列出所有 JS/JSX 源文件。 */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if ([".js", ".jsx"].includes(extname(entry))) out.push(path);
  }
  return out;
}

/**
 * 源码里作为字面文本出现过的"词"。
 *
 * 本来想用 TypeScript 的解析器，但这个仓库的 typescript 是 7.0.2
 * （Go 重写版），ESM 和 CJS 都只导出 version，没有 createSourceFile。
 * 所以退回自己分词，但**逐行**分：错位最多影响它自己那一行，
 * 不会像上一版那样从某个引号开始把后面所有文件一起带偏。
 *
 * 每行取出所有引号包起来的片段，按空白切词。
 * 带连字符的类名是一个完整的词，不会被切开。
 *
 * 模板串里的 ${} 必须**递归**再进去找一遍，不能整段抹掉。
 * 这个项目里最常见的条件类名就长这样：
 *
 *   className={`sidebar ${open ? "open" : ""}`}
 *   className={`now-workspace ${track ? "" : "empty"}`}
 *
 * 抹掉 ${} 的那一版只收到了 "sidebar" 和 "now-workspace"，
 * 于是 .open / .empty / .idle / .follow / .remote 五个还在用的类
 * 全被判死。它们都是状态类，删掉之后侧栏展开、空状态、
 * 设备离线这些样子会静默失效 —— 构建不报错，测试也测不到。
 */
const USED_WORDS = (() => {
  const words = new Set();
  const addWords = (text) => {
    for (const word of text.split(/\s+/)) if (word) words.add(word);
  };
  /** 收一段代码里所有字面量的词，遇到 ${} 就往里再收一层。 */
  const collect = (code, depth = 0) => {
    if (depth > 6) return;
    for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      const body = match[2];
      let cursor = 0;
      for (const interp of body.matchAll(/\$\{([^}]*)\}/g)) {
        addWords(body.slice(cursor, interp.index));
        collect(interp[1], depth + 1);
        cursor = interp.index + interp[0].length;
      }
      addWords(body.slice(cursor));
    }
  };
  for (const path of sourceFiles(ROOT)) {
    for (const line of readFileSync(path, "utf8").split("\n")) collect(line);
  }
  return words;
})();

/*
 * 自检。
 *
 * 上一版的正则分词把这几个还在用的类名全判成了死的，报告说要删
 * 884 条规则 —— 只差一个 --apply 就把在用的样式删光了。所以现在
 * 每次运行都先确认这几个"一定活着"的类名确实判活。分词一旦再出问题，
 * 脚本会直接退出，而不是给出一份看起来很划算的删除报告。
 */
const CANARIES = ["ui-btn", "mini-player", "now-notice", "login__card", "sidebar"];
const brokenCanaries = CANARIES.filter((cls) => !USED_WORDS.has(cls));
if (brokenCanaries.length) {
  console.error(
    `分词自检失败：${brokenCanaries.join("、")} 明明在用却没被收进词表。` +
      `\n先修分词，不要相信这次的报告。`,
  );
  process.exit(1);
}

/**
 * 拼出来的类名，字符串搜索找不到，必须手工保住。
 *
 * 每一条都对应源码里一处模板串：
 *   AuthenticatedShell  `route-${active}`      → route-home / route-player / ...
 *   PlaylistsPage       `tone-${index % 4}`    → tone-0..3
 *
 * 往这里加东西之前先确认：真的是拼出来的，而不是"我觉得可能还有用"。
 * 后者会让这个脚本失去意义。
 */
const COMPOSED = [/^route-/, /^tone-\d+$/];

/** 判死过的类名，--list 用它输出清单。 */
const deadSeen = new Set();

const isDead = (cls) => {
  const dead =
    !COMPOSED.some((pattern) => pattern.test(cls)) && !USED_WORDS.has(cls);
  if (dead) deadSeen.add(cls);
  return dead;
};

/** 选择器里的类名。伪类和伪元素不算。 */
function classesIn(selector) {
  return [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/**
 * 极简 CSS 分块器。
 *
 * 只需要区分三件事：at 规则（可能嵌套）、样式规则、其余原样保留。
 * 用括号深度扫描而不是正则 —— 选择器里可能有 `>`、`+`、属性选择器，
 * 正则很容易在这些地方断掉（之前就在 `=>` 上栽过）。
 */
function splitBlocks(css) {
  const blocks = [];
  let index = 0;
  while (index < css.length) {
    const braceAt = css.indexOf("{", index);
    if (braceAt === -1) {
      blocks.push({ type: "raw", text: css.slice(index) });
      break;
    }
    const prelude = css.slice(index, braceAt);
    let depth = 0;
    let end = braceAt;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = css.slice(braceAt + 1, end);
    blocks.push({ type: "rule", prelude, body });
    index = end + 1;
  }
  return blocks;
}

/** 去掉注释再判断，否则注释里的 `@media` 会被当成 at 规则。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 按顶层逗号切分选择器列表。
 *
 * 不能直接 split(",")：`:is(.a, .b)`、`:not(.x, .y)`、`[attr="a,b"]`
 * 里面都有逗号。直接切会把 `:is(.a` 当成一个选择器，写回去就是
 * 括号不配对的 CSS，postcss 直接报 Unclosed bracket。
 */
function splitSelectorList(text) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function prune(css, stats) {
  return splitBlocks(css)
    .map((block) => {
      if (block.type === "raw") return block.text;
      const prelude = block.prelude;
      const trimmed = stripComments(prelude).trim();

      // @keyframes 内部是关键帧，不是选择器 —— 整块原样带走。
      if (/^@keyframes/i.test(trimmed) || /^@font-face/i.test(trimmed)) {
        return `${prelude}{${block.body}}`;
      }

      // 其他 at 规则（@media / @supports / @layer）递归处理内部。
      if (trimmed.startsWith("@")) {
        const inner = prune(block.body, stats);
        // 内部被清空的 @media 也一起删掉，不留空壳。
        if (!stripComments(inner).trim()) {
          stats.emptyAtRules += 1;
          return "";
        }
        return `${prelude}{${inner}}`;
      }

      const selectors = splitSelectorList(trimmed);
      const kept = selectors.filter((selector) => {
        const classes = classesIn(selector);
        return classes.length === 0 || !classes.some(isDead);
      });

      if (kept.length === 0) {
        stats.removedRules += 1;
        stats.removedLines += `${prelude}{${block.body}}`.split("\n").length;
        return "";
      }
      if (kept.length !== selectors.length) {
        stats.trimmedSelectors += selectors.length - kept.length;
        return `\n${kept.join(",\n")}{${block.body}}`;
      }
      return `${prelude}{${block.body}}`;
    })
    .join("");
}

const apply = process.argv.includes("--apply");
const total = { removedRules: 0, trimmedSelectors: 0, emptyAtRules: 0, removedLines: 0 };

for (const file of LEGACY) {
  const path = join(ROOT, file);
  const before = readFileSync(path, "utf8");
  const stats = { removedRules: 0, trimmedSelectors: 0, emptyAtRules: 0, removedLines: 0 };
  const after = prune(before, stats);
  for (const key of Object.keys(total)) total[key] += stats[key];
  const beforeLines = before.split("\n").length;
  const afterLines = after.split("\n").length;
  console.log(
    `${file}: ${beforeLines} → ${afterLines} 行 | ` +
      `删规则 ${stats.removedRules} | 删选择器 ${stats.trimmedSelectors} | 空 at 规则 ${stats.emptyAtRules}`,
  );
  if (apply) writeFileSync(path, after);
}

console.log(
  `\n合计：删规则 ${total.removedRules}，删单个选择器 ${total.trimmedSelectors}，` +
    `清空 at 规则 ${total.emptyAtRules}`,
);

if (process.argv.includes("--list")) {
  console.log(`\n判死的类名（${deadSeen.size} 个）：`);
  for (const cls of [...deadSeen].sort()) console.log(`  .${cls}`);
}

if (!apply) console.log("（只是报告。加 --apply 才写回。）");
