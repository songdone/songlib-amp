/**
 * 分析工具：列出 main.jsx 的全部顶层声明、行范围，以及彼此的引用关系。
 * 拆分模块前用它确认分组不会产生循环依赖。
 *
 * 用法：node scripts/analyze-main.mjs [--deps]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../src/main.jsx");
const source = fs.readFileSync(target, "utf8");
const lines = source.split("\n");

/**
 * 找出所有顶层声明（缩进为 0 的 function / const / class）。
 * main.jsx 全部组件都是顶层函数，所以按缩进判断足够可靠。
 */
const declPattern =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\s+([A-Za-z0-9_$]+)|(?:const|let|var|class)\s+([A-Za-z0-9_$]+))/;

const decls = [];
lines.forEach((line, index) => {
  const match = line.match(declPattern);
  if (!match) return;
  const name = match[2] || match[3];
  if (!name) return;
  decls.push({ name, start: index + 1, kind: match[1] ? "function" : "binding" });
});

// 每个声明的结束行 = 下一个顶层声明的前一行。
decls.forEach((decl, index) => {
  decl.end = index + 1 < decls.length ? decls[index + 1].start - 1 : lines.length;
  decl.body = lines.slice(decl.start - 1, decl.end).join("\n");
  decl.size = decl.end - decl.start + 1;
});

const names = new Set(decls.map((d) => d.name));

/** 某个声明体里引用到的其他顶层声明。 */
const referencesOf = (decl) => {
  const found = new Set();
  for (const name of names) {
    if (name === decl.name) continue;
    // 词边界匹配，避免 Player 命中 PlayerProvider。
    const pattern = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
    if (pattern.test(decl.body)) found.add(name);
  }
  return [...found];
};

if (process.argv.includes("--deps")) {
  for (const decl of decls) {
    const refs = referencesOf(decl);
    console.log(
      `${decl.name} (${decl.start}-${decl.end}, ${decl.size}) -> ${refs.length ? refs.join(", ") : "-"}`,
    );
  }
} else {
  console.log(`共 ${decls.length} 个顶层声明，文件 ${lines.length} 行\n`);
  for (const decl of decls) {
    console.log(
      `${String(decl.start).padStart(5)}-${String(decl.end).padEnd(5)} ${String(decl.size).padStart(5)}行  ${decl.kind === "function" ? "fn " : "var"} ${decl.name}`,
    );
  }
}
