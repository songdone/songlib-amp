/**
 * 删掉旧样式表里永远不可能匹配的规则。
 *
 * 判据只有一条，很硬：一个选择器里如果出现了任何一个在全部
 * JS/JSX 源码里都找不到的类名，这个选择器就永远匹配不到元素。
 * 逗号分隔的选择器逐个判断 —— 一条规则里可能有的还活着，
 * 那就只删死掉的那几个，保留规则本体。
 *
 * 为什么用"整个源码里搜字符串"而不是解析 className：
 * 有些类名是拼出来的（`${kind}-card`、模板串、数组 join），
 * 解析 JSX 会漏。搜字符串会把"其实是别的用途的同名字符串"也算成
 * 活着 —— 宁可漏删，不能错删。
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

/** 递归收集所有 JS/JSX 源码，拼成一个大字符串用于存在性检查。 */
function sourceBlob(dir) {
  let out = "";
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out += sourceBlob(path);
    } else if ([".js", ".jsx"].includes(extname(entry))) {
      out += readFileSync(path, "utf8");
    }
  }
  return out;
}

const blob = sourceBlob(ROOT);

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

const isDead = (cls) =>
  !COMPOSED.some((pattern) => pattern.test(cls)) && !blob.includes(cls);

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
if (!apply) console.log("（只是报告。加 --apply 才写回。）");
