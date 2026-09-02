/**
 * 修正 wrap-legacy-layers.mjs 的一个错误假设。
 *
 * 那个脚本假定"后来的改版层应该压过先前的"，于是把 5 个历史样式表按导入顺序
 * 装进 legacy.* 子层并移除全部 !important。这对 commercial / liquid-glass /
 * shell-refactor 是对的 —— 它们的 !important 确实是用来压过前一层的。
 *
 * 但 styles.css 是最底层。它那 180 处 !important 作用相反：是在**保护**
 * 基础规则不被后面四个文件覆盖。剥掉之后这些声明反而输了，
 * 表现为 .artist-backdrop img 的 brightness(.55) 失效，
 * 浅色的 fallback 背景图不再被压暗，内容区出现一层灰罩。
 *
 * 这里从重构前的 styles.css 里精确提取**当初带 !important 的那些声明**
 * （不是整条规则 —— 同一条规则里没带 !important 的声明当初就是可被覆盖的），
 * 放进 legacy.protected 层。该层排在所有 legacy 子层之后，
 * 于是层级顺序精确复现了原来的优先级，仍然不需要 !important。
 *
 * 用法：node scripts/extract-protected-rules.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../src/styles/legacy-protected.css");

/** 重构前的 styles.css。 */
const original = execSync("git show e2bda82:frontend/src/styles.css", {
  cwd: path.resolve(here, "../.."),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

/**
 * 极简 CSS 遍历：够用是因为这个文件只有 @media 一层嵌套，没有 @supports。
 * 产出 [{ media, selector, declarations[] }]，只保留带 !important 的声明。
 */
const collect = (css) => {
  const out = [];
  let index = 0;

  const readBlock = (start) => {
    let depth = 0;
    for (let i = start; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return css.length;
  };

  const parseRules = (text, media) => {
    let cursor = 0;
    while (cursor < text.length) {
      const brace = text.indexOf("{", cursor);
      if (brace === -1) break;
      const selector = text.slice(cursor, brace).trim();
      const close = (() => {
        let depth = 0;
        for (let i = brace; i < text.length; i += 1) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") {
            depth -= 1;
            if (depth === 0) return i;
          }
        }
        return text.length;
      })();
      const body = text.slice(brace + 1, close);
      if (selector.startsWith("@")) {
        // 只可能是 @media / @keyframes；keyframes 里不会有需要保护的声明。
        if (selector.startsWith("@media")) parseRules(body, selector);
      } else if (selector) {
        const kept = body
          .split(";")
          .map((d) => d.trim())
          .filter((d) => /!\s*important/.test(d))
          .map((d) => d.replace(/\s*!\s*important/, ""));
        if (kept.length) out.push({ media, selector, declarations: kept });
      }
      cursor = close + 1;
    }
  };

  parseRules(css, null);
  void index;
  void readBlock;
  return out;
};

/**
 * 解析前先去掉注释。
 * 否则 `/* 说明 *​/\n@media(...)` 会被当成一个不以 @ 开头的选择器，
 * 整个 media 块被误当普通规则输出，产生不配对的花括号。
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const rules = collect(stripComments(original));

/** 按 @media 归组，保持原顺序。 */
const groups = new Map();
for (const rule of rules) {
  const key = rule.media || "";
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(rule);
}

const renderRule = (rule, indent) =>
  `${indent}${rule.selector} {\n` +
  rule.declarations.map((d) => `${indent}  ${d};`).join("\n") +
  `\n${indent}}`;

const sections = [];
for (const [media, items] of groups) {
  if (!media) {
    sections.push(items.map((r) => renderRule(r, "  ")).join("\n\n"));
  } else {
    sections.push(
      `  ${media} {\n${items.map((r) => renderRule(r, "    ")).join("\n\n")}\n  }`,
    );
  }
}

const header = `/**
 * 重构前 styles.css 里带 !important 的声明。
 *
 * styles.css 当年是第一个被导入的样式表，这些 !important 的作用是**保护**
 * 基础规则不被后面四个样式表覆盖，而不是压过它们。把它们平铺进 legacy.base
 * 会让优先级反转 —— 典型症状是 .artist-backdrop img 的 brightness(.55) 失效，
 * 浅色 fallback 背景图不再被压暗，内容区出现一层灰罩。
 *
 * 这一层排在所有 legacy.* 子层之后（见 index.css 的 @layer 声明），
 * 用层级顺序精确复现原来的优先级，因此这里不需要也不允许出现 !important。
 *
 * 这个文件由 scripts/extract-protected-rules.mjs 从 git 历史生成，不要手改。
 * 迁移某个组件到设计 token 时，把它对应的规则从这里删掉。
 */

@layer legacy.protected {
`;

fs.writeFileSync(outFile, `${header}${sections.join("\n\n")}\n}\n`, "utf8");

const total = rules.reduce((sum, r) => sum + r.declarations.length, 0);
console.log(
  `写入 ${outFile.split("/").slice(-2).join("/")}：${rules.length} 条规则，${total} 个受保护声明。`,
);
