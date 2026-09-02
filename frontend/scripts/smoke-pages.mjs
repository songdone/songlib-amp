/**
 * 逐页冒烟：每个页面 × 深浅两个主题，检查两件事。
 *
 *   1. 有没有 console error / 未捕获异常
 *   2. 有没有"和背景几乎同色"的文字
 *
 * 第二项是为了一类真实事故：正在播放页的文字色钉在浅色调上，
 * 底色却跟着主题变，浅色主题下整页文字对比度 1.07 —— 构建过、
 * 测试全绿、对比度脚本也过（它只查 token 组合，不查实际渲染），
 * 只有人打开那一页才看得见。
 *
 * 已知的一类假阳性：background-clip:text 的元素靠背景渐变画字形，
 * color 是 transparent，读 color 会得出完全错误的结论。已跳过。
 *
 * 用法：
 *   先起一个服务（node mock-server.mjs），然后
 *   PLAYWRIGHT=<playwright 入口> node scripts/smoke-pages.mjs [baseUrl]
 *
 * playwright 不是本仓库的依赖（只在开发机上装），所以路径从环境变量来，
 * 不进 package.json 的 test 脚本 —— CI 里不该因为缺一个可选工具而红。
 */

const PLAYWRIGHT =
  process.env.PLAYWRIGHT ||
  "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.js";
const BASE = process.argv[2] || "http://127.0.0.1:4174";

const pw = (await import(PLAYWRIGHT)).default;
const b = await pw.chromium.launch();
let failures = 0;
const routes = [
  ["/", "首页"], ["/library/artists", "音乐库"], ["/playlists", "歌单"],
  ["/discover", "发现"], ["/player", "正在播放"], ["/manage/downloads", "下载入库"],
  ["/manage/library", "文件与标签"], ["/manage/metadata", "封面与歌词"],
  ["/manage/tasks", "任务"], ["/settings", "设置"], ["/search", "搜索"], ["/me", "我的"],
];
for (const theme of ["dark", "light"]) {
  const ctx = await b.newContext({viewport:{width:1440,height:1000}});
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(`${e.message.slice(0,140)}`));
  p.on("console", m => m.type()==="error" && errs.push(m.text().slice(0,140)));
  await p.goto(BASE + "/", {waitUntil:"networkidle"});
  await p.evaluate(t => { document.documentElement.dataset.theme = t; localStorage.setItem("songlib-appearance", JSON.stringify({mode:t})); }, theme);
  for (const [path, label] of routes) {
    const before = errs.length;
    await p.goto(BASE + path, {waitUntil:"networkidle"});
    await p.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await p.waitForTimeout(900);
    // 找不可读的文字：前景色和背景色几乎一样
    const bad = await p.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("h1,h2,h3,strong,p,small,button,a,code,time,span")) {
        if (!el.offsetParent && el.tagName !== "BODY") continue;
        const t = el.textContent.trim();
        if (!t || t.length > 60 || el.children.length) continue;
        const cs = getComputedStyle(el);
        // background-clip:text 的元素靠背景渐变画字形，color 是 transparent，
        // 读 color 判断对比度会得出完全错误的结论（首页那个渐变标题就被误报过）。
        if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") continue;
        const fg = cs.color.match(/\d+/g)?.slice(0,3).map(Number);
        if (!fg) continue;
        let node = el, bg = null;
        while (node) {
          const c = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
          if (c && (c.length < 4 || Number(c[3]) > 0.85)) { bg = c.slice(0,3).map(Number); break; }
          node = node.parentElement;
        }
        if (!bg) continue;
        const lum = ([r,g,b]) => { const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) };
        const [a1,a2] = [lum(fg), lum(bg)].sort((x,y)=>y-x);
        const ratio = (a1+0.05)/(a2+0.05);
        if (ratio < 1.6) out.push({ text: t.slice(0,24), ratio: +ratio.toFixed(2) });
      }
      return out.slice(0, 4);
    });
    const newErrs = errs.length - before;
    if (newErrs || bad.length) failures += 1;
    const flag = (newErrs || bad.length) ? "  <<<" : "";
    console.log(`${theme} ${label.padEnd(8)} err=${newErrs} 低对比=${bad.length}${bad.length?" "+JSON.stringify(bad):""}${flag}`);
  }
  await ctx.close();
}
await b.close();
if (failures) {
  console.error(`\n${failures} 处需要看一眼。`);
  process.exit(1);
}
console.log("\n所有页面 × 两个主题：无报错、无低对比文字。");
