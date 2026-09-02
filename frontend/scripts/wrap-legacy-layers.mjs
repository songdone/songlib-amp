/**
 * 一次性迁移脚本：把 5 个历史样式表装进 CSS @layer 子层，并移除 !important。
 *
 * 背景：这 5 个文件是三次改版的化石层（commercial → liquid-glass →
 * shell-refactor），每一次都叠在上面用 !important 压过前一层，累计 235 处。
 *
 * 做法：按它们原本在 main.jsx 里的导入顺序分配子层
 *   legacy.base < legacy.commercial < legacy.glass < legacy.nowplaying < legacy.shell
 * 层级顺序本身就保证"后来的压过先前的"，与 !important 原本要达到的效果一致，
 * 所以可以安全地把 !important 去掉。
 *
 * 同文件内用 !important 压过更高特异性选择器的少数情况，层级帮不上忙，
 * 需要靠迁移后的逐页视觉核对来兜底 —— 见 docs/UI-REFACTOR.md。
 *
 * 用法：node scripts/wrap-legacy-layers.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");

/** 顺序 = 原 main.jsx 的导入顺序 = 历史叠加顺序。不要调整。 */
const LEGACY_FILES = [
  { file: "styles.css", layer: "legacy.base" },
  { file: "commercial.css", layer: "legacy.commercial" },
  { file: "liquid-glass.css", layer: "legacy.glass" },
  { file: "features/now-playing/now-playing.css", layer: "legacy.nowplaying" },
  { file: "features/shell/shell-refactor.css", layer: "legacy.shell" },
];

const dryRun = process.argv.includes("--dry-run");

/** 每行缩进两格，保持包进 @layer 后仍然可读。 */
const indent = (text) =>
  text
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join("\n");

let totalImportant = 0;
const report = [];

for (const { file, layer } of LEGACY_FILES) {
  const full = path.join(srcDir, file);
  const original = fs.readFileSync(full, "utf8");

  if (original.includes("@layer")) {
    report.push(`跳过 ${file}：已经在 @layer 内`);
    continue;
  }

  const importantCount = (original.match(/!\s*important/g) || []).length;
  totalImportant += importantCount;

  // 去掉 !important：层级顺序已经接管了优先级。
  const stripped = original.replace(/\s*!\s*important/g, "");

  const wrapped = `/* 迁移说明：本文件是重构前的历史样式层，已装入 ${layer}。
 * 新代码请写在 src/styles/ 的设计系统里，不要再往这里加规则。
 * 每迁走一块，就从这里删掉对应的规则。 */

@layer ${layer} {
${indent(stripped.trimEnd())}
}
`;

  if (!dryRun) fs.writeFileSync(full, wrapped, "utf8");
  report.push(
    `${dryRun ? "[试运行] " : ""}${file} → @layer ${layer}，移除 ${importantCount} 处 !important`,
  );
}

console.log(report.join("\n"));
console.log(`\n合计移除 ${totalImportant} 处 !important。`);
