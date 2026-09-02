/**
 * 设计 token 对比度门禁。
 *
 * 读取 src/styles/tokens.css，解析每个主题的语义 token，
 * 按 WCAG 2.1 相对亮度算前景/背景对比度，并断言成对的组合达标。
 * 任何一对不达标就以非零码退出，供 CI 和 pnpm test 使用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensFile = path.resolve(here, "../src/styles/tokens.css");

/** WCAG 小号正文与 UI 图形的最低要求。 */
const AA_TEXT = 4.5;
const AA_LARGE = 3;
const AA_NON_TEXT = 3;

const srgbToLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ({ r, g, b }) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const parseHex = (value) => {
  const hex = value.replace("#", "").trim();
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6,8}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
};

const parseRgb = (value) => {
  const match = value.match(
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
  );
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
};

const parseColor = (value) => parseHex(value) ?? parseRgb(value);

/** 半透明前景先按 alpha 合成到背景上，再算对比度。 */
const composite = (fg, bg) =>
  fg.a >= 1
    ? fg
    : {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      };

const contrast = (fgRaw, bgRaw) => {
  const bg = bgRaw;
  const fg = composite(fgRaw, bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * 从 tokens.css 里按选择器块提取自定义属性。
 * 只关心 :root（深色默认）与 [data-theme="light"]。
 */
const readThemes = (css) => {
  const themes = {};
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = blockPattern.exec(css))) {
    const selector = match[1].trim();
    const body = match[2];
    let themeName = null;
    if (/(^|,)\s*:root\s*$/.test(selector) || selector === ":root") themeName = "dark";
    else if (selector.includes('[data-theme="light"]')) themeName = "light";
    if (!themeName) continue;
    themes[themeName] = themes[themeName] || {};
    const declPattern = /(--[a-z0-9-]+)\s*:\s*([^;]+)/gi;
    let decl;
    while ((decl = declPattern.exec(body))) {
      themes[themeName][decl[1]] = decl[2].trim();
    }
  }
  // 浅色主题继承深色里未被覆盖的 token。
  themes.light = { ...themes.dark, ...(themes.light || {}) };
  return themes;
};

/** 把 var(--x) 引用解开到字面颜色。 */
const resolve = (tokens, name, seen = new Set()) => {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = tokens[name];
  if (!raw) return null;
  const varRef = raw.match(/^var\(\s*(--[a-z0-9-]+)/i);
  if (varRef) return resolve(tokens, varRef[1], seen);
  return parseColor(raw);
};

/**
 * 需要成立的组合。level 决定门槛：
 * text = 4.5、large = 3、non-text = 3。
 */
const PAIRS = [
  // 正文与各层表面
  ["--text-primary", "--surface-canvas", "text"],
  ["--text-primary", "--surface-1", "text"],
  ["--text-primary", "--surface-2", "text"],
  ["--text-primary", "--surface-3", "text"],
  ["--text-secondary", "--surface-canvas", "text"],
  ["--text-secondary", "--surface-1", "text"],
  ["--text-secondary", "--surface-2", "text"],
  ["--text-tertiary", "--surface-canvas", "text"],
  ["--text-tertiary", "--surface-1", "text"],
  ["--text-tertiary", "--surface-2", "text"],
  // 强调色作为文字
  ["--accent-text", "--surface-canvas", "text"],
  ["--accent-text", "--surface-1", "text"],
  ["--accent-text", "--surface-2", "text"],
  // 强调色实心按钮：底上的文字
  ["--accent-on-solid", "--accent-solid", "text"],
  // 语义状态色作为文字
  ["--success-text", "--surface-1", "text"],
  ["--warning-text", "--surface-1", "text"],
  ["--danger-text", "--surface-1", "text"],
  ["--info-text", "--surface-1", "text"],
  // 非文字：边框、焦点环、分隔线需要能被看见
  ["--border-strong", "--surface-1", "non-text"],
  ["--focus-ring", "--surface-canvas", "non-text"],
  ["--focus-ring", "--surface-1", "non-text"],
  // 大号标题允许 3:1
  ["--text-disabled", "--surface-1", "large"],
];

const threshold = (level) =>
  level === "text" ? AA_TEXT : level === "large" ? AA_LARGE : AA_NON_TEXT;

const run = () => {
  if (!fs.existsSync(tokensFile)) {
    console.error(`找不到 token 文件：${tokensFile}`);
    process.exit(1);
  }
  const themes = readThemes(fs.readFileSync(tokensFile, "utf8"));
  const failures = [];
  const rows = [];

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const [fgName, bgName, level] of PAIRS) {
      const fg = resolve(tokens, fgName);
      const bg = resolve(tokens, bgName);
      if (!fg || !bg) {
        failures.push(`${themeName}: 无法解析 ${fgName} 或 ${bgName}`);
        continue;
      }
      const ratio = contrast(fg, bg);
      const min = threshold(level);
      const ok = ratio >= min;
      rows.push(
        `${ok ? "  ok" : "FAIL"}  ${themeName.padEnd(5)} ${fgName.padEnd(20)} on ${bgName.padEnd(18)} ${ratio.toFixed(2)}:1 (需要 ${min})`,
      );
      if (!ok) {
        failures.push(
          `${themeName}: ${fgName} on ${bgName} = ${ratio.toFixed(2)}:1，低于 ${min}`,
        );
      }
    }
  }

  console.log(rows.join("\n"));
  console.log(
    `\n${rows.length} 组组合，${failures.length} 组不达标（深色 + 浅色两个主题）。`,
  );
  if (failures.length) {
    console.error("\n对比度门禁未通过：");
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
};

run();
