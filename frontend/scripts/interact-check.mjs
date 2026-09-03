/**
 * 交互冒烟：真的去点、去等、去滚。
 *
 * 为什么要有这个：smoke-pages.mjs 只渲染首屏然后看一眼，而实际报上来的
 * bug 全是"上手操作 30 秒才会遇到"那一类 ——
 *
 *   - 海报模板选了别的，一秒后被按回默认（要点一下再等）
 *   - 歌词从不跟着歌走（要等 30 秒）
 *   - 全屏歌词开着，底层还能滚（要滚一下）
 *   - 9:16 顶部大片空白（要切比例）
 *
 * 首屏截图对这四种一律看不见。所以这里的每条检查都必须包含
 * "操作 → 等一会儿 → 再断言"。
 */

const CANDIDATES = [
  process.env.PLAYWRIGHT,
  "playwright",
  "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.js",
].filter(Boolean);
let pw = null;
for (const entry of CANDIDATES) {
  try { pw = (await import(entry)).default; break; } catch { /* 下一个 */ }
}
if (!pw) { console.error("找不到 playwright"); process.exit(1); }

const BASE = process.argv[2] || "http://127.0.0.1:4174";
const problems = [];
const note = (what) => { problems.push(what); console.log("  ✗", what); };
const ok = (what) => console.log("  ✓", what);

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => note(`未捕获异常：${e.message.slice(0, 120)}`));
page.on("console", (m) => m.type() === "error" && note(`控制台报错：${m.text().slice(0, 120)}`));

await page.addInitScript(() => localStorage.setItem("songlib-pwa-dismissed", "1"));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const nav = (label) => page.locator("nav button, aside button").filter({ hasText: label }).first().click();

// 起播一首，后面所有检查都需要有歌在放
const play = page.getByRole("button", { name: /播放这张专辑/ }).first();
if (await play.count()) { await play.click(); await page.waitForTimeout(1000); }
await nav("正在播放");
await page.waitForTimeout(900);

/* ---------- 1. 分享图：选了模板必须留得住 ---------- */
console.log("\n分享图");
await page.getByRole("button", { name: /分享图/ }).first().click();
await page.waitForTimeout(700);

const chips = page.locator(".ui-modal .ui-chip");
const chipCount = await chips.count();
if (chipCount < 4) note(`可选样式只有 ${chipCount} 个`);
else ok(`可选样式 ${chipCount} 个`);

for (let i = 0; i < chipCount; i += 1) {
  const label = (await chips.nth(i).innerText()).split("\n")[0];
  await chips.nth(i).click();
  // 关键：等 2.5 秒。播放时钟每秒触发一次重渲染，
  // 上游引用不稳的话这段时间足够把选中态冲掉。
  await page.waitForTimeout(2500);
  const stillOn = await chips.nth(i).getAttribute("aria-pressed");
  if (stillOn !== "true") note(`样式「${label}」点了留不住，2.5 秒后被按回默认`);
  else ok(`样式「${label}」选中态稳定`);
}

/* ---------- 2. 分享图：逐个模板 × 逐个比例量顶部留白 ---------- */
// 只量比例不量模板是错的：「极简」本来就把内容放在中下部，它的留白
// 说明不了「歌词」模板在 9:16 下顶部空一片这件事。
const topGap = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".ui-modal canvas");
    if (!canvas) return null;
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const cx = c.getContext("2d");
    cx.drawImage(canvas, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    /*
     * 量的是**构图平衡**，不是"有多空"。
     *
     * 两行歌词的 9:16 本来就该大量留白，"空"本身不是毛病。用户说的
     * "上方太空"实际是上下不对称、头重 —— 原来上方 878px、下方 434px。
     * 所以这里出三个数：
     *   top / bottom  上下外边距
     *   hole          首末内容之间最长的一段空白
     * 判定：上下差得太多 = 头重或脚重；中间那段比外边距大得多 = 画面裂开。
     */
    const filled = [];
    for (let y = 0; y < c.height; y += 2) {
      let min = 255;
      let max = 0;
      for (let x = 0; x < c.width; x += 4) {
        const i = (y * c.width + x) * 4;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < min) min = l;
        if (l > max) max = l;
      }
      filled.push(max - min > 42);
    }
    const firstAt = filled.indexOf(true);
    const lastAt = filled.lastIndexOf(true);
    if (firstAt < 0) return { blank: true, height: c.height };
    let hole = 0;
    let holeAt = 0;
    let run = 0;
    for (let i = firstAt; i <= lastAt; i += 1) {
      if (filled[i]) { run = 0; continue; }
      run += 2;
      if (run > hole) { hole = run; holeAt = i * 2 - run; }
    }
    return {
      top: firstAt * 2,
      bottom: c.height - lastAt * 2,
      hole,
      holeAt,
      height: c.height,
    };
  });

const styleChips = page.locator(".ui-modal .ui-chips").first().locator(".ui-chip");
const ratioChips = page.locator(".ui-modal .ui-chips").nth(1).locator(".ui-chip");
const styleCount = await styleChips.count();
const ratioCount = await ratioChips.count();
for (let s = 0; s < styleCount; s += 1) {
  const styleName = (await styleChips.nth(s).innerText()).split("\n")[0];
  await styleChips.nth(s).click();
  for (let r = 0; r < ratioCount; r += 1) {
    const ratioName = (await ratioChips.nth(r).innerText()).split("\n")[0].replace(/\s.*/, "");
    await ratioChips.nth(r).click();
    await page.waitForTimeout(450);
    const gap = await topGap();
    if (!gap) { note("拿不到画布像素"); continue; }
    if (gap.blank) { note(`${styleName} × ${ratioName} 整张是空的`); continue; }
    const name = `${styleName} × ${ratioName}`;
    const pc = (v) => Math.round((v / gap.height) * 100);
    // 头重/脚重：上下外边距差超过画布高的 14%
    const skew = pc(Math.abs(gap.top - gap.bottom));
    // 画面裂开：中间那段空白比两侧外边距里大的那个还大 60% 以上
    const outer = Math.max(gap.top, gap.bottom, 1);
    const split = gap.hole > outer * 1.6 && pc(gap.hole) > 18;
    if (skew > 14)
      note(`${name} 上下不平：上 ${pc(gap.top)}% 下 ${pc(gap.bottom)}%`);
    else if (split)
      note(`${name} 中间裂开一段 ${pc(gap.hole)}%（y=${gap.holeAt}）`);
    else ok(`${name} 上 ${pc(gap.top)}% 下 ${pc(gap.bottom)}% 中间 ${pc(gap.hole)}%`);
  }
}

await page.locator(".ui-modal").getByRole("button", { name: /关闭|取消/ }).first().click().catch(() => {});
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* ---------- 3. 全屏歌词：底层不许动 ---------- */
console.log("\n全屏歌词");
const full = page.getByRole("button", { name: /全屏歌词/ }).first();
if (!(await full.count())) note("找不到「全屏歌词」入口");
else {
  await full.click();
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.scrollY);
  if (after !== before) note(`全屏歌词开着时底层还能滚（scrollY ${before} → ${after}）`);
  else ok("底层滚动已锁住");

  const bodyLocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  if (bodyLocked !== "hidden") note(`body overflow 是 ${bodyLocked}，应为 hidden`);
  else ok("body overflow: hidden");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const restored = await page.evaluate(() => getComputedStyle(document.body).overflow);
  if (restored === "hidden") note("关掉全屏歌词后 body 还锁着，页面滚不动了");
  else ok("关掉后滚动已恢复");
}

/* ---------- 4. 歌词：面板要能内部滚，当前句要跟着走 ---------- */
console.log("\n歌词");
const box = await page.evaluate(() => {
  const el = document.querySelector(".now-lyrics-lines");
  if (!el) return null;
  return {
    lines: el.children.length,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    pageHeight: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  };
});
if (!box) note("找不到歌词列表");
else if (box.lines < 12) note(`歌词只有 ${box.lines} 行，测不出滚动（mock 数据要够长）`);
else {
  // 这条守的是一个真炸过的 bug：歌词面板没有高度约束，有多少行就长多高，
  // align-items:stretch 又把左栏一起拉高，于是滚的是整个页面而不是面板。
  if (box.scrollHeight <= box.clientHeight + 8)
    note(`歌词面板不可内部滚动（client ${box.clientHeight} / scroll ${box.scrollHeight}），说明它被内容撑开了`);
  else ok(`歌词面板可内部滚动（${box.clientHeight} / ${box.scrollHeight}）`);
  if (box.pageHeight > box.viewport + 40)
    note(`正在播放页整页被撑到 ${box.pageHeight}（视口 ${box.viewport}），主区没有视口约束`);
  else ok("整页没有被歌词撑开");

  // 点靠后的一句触发 seek，比等一分钟快，且能确定地检验跟随
  const lines = page.locator(".now-lyrics-lines button");
  const total = await lines.count();
  await lines.nth(total - 4).click();
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => {
    const el = document.querySelector(".now-lyrics-lines");
    const idx = [...el.children].findIndex((c) => c.classList.contains("active"));
    return { idx, scrollTop: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight };
  });
  if (after.idx < 12) note(`点了倒数第 4 句，当前句却是第 ${after.idx} 句，seek 没生效`);
  else if (after.scrollTop === 0)
    note("当前句到了列表末尾，歌词却没有跟着滚动");
  else ok(`歌词跟随生效（当前第 ${after.idx} 句，scrollTop ${after.scrollTop}/${after.max}）`);
}

/* ---------- 5. 全站找超大字号的正文 ---------- */
console.log("\n字号");
for (const [label, name] of [["发现", "discover"], ["正在播放", "now"], ["首页", "home"]]) {
  await nav(label).catch(() => {});
  await page.waitForTimeout(900);
  const big = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length) continue;
      const text = (el.textContent || "").trim();
      if (!text || text.length < 2) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      // 标题可以大；这里只挑"不是标题却很大"的
      if (size >= 34 && !/^H[1-3]$/.test(el.tagName)) {
        out.push(`${el.tagName}.${el.className}`.slice(0, 60) + ` ${Math.round(size)}px「${text.slice(0, 14)}」`);
      }
    }
    return [...new Set(out)].slice(0, 6);
  });
  if (big.length) big.forEach((item) => note(`${label}页 字号偏大：${item}`));
  else ok(`${label}页 无异常大字`);
}

/* ---------- 6. 设置页：权限勾选框不该是大方块 ---------- */
console.log("\n设置页权限勾选");
await nav("设置");
await page.waitForTimeout(900);
const secTab = page.locator(".settings-nav button, aside button").filter({ hasText: "用户与安全" }).first();
if (await secTab.count()) { await secTab.click(); await page.waitForTimeout(900); }
const boxes = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".account-permissions input[type=checkbox]")) {
    const r = el.getBoundingClientRect();
    out.push({ w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
});
if (!boxes.length) console.log("  — 没渲染出权限勾选框（可能 mock 没这块）");
else {
  const huge = boxes.filter((b) => b.w > 26 || b.h > 26);
  if (huge.length) note(`权限勾选框被撑大：${JSON.stringify(huge[0])}，共 ${huge.length} 个`);
  else ok(`权限勾选框尺寸正常 ${JSON.stringify(boxes[0])}`);
}

await browser.close();
console.log(problems.length ? `\n发现 ${problems.length} 个问题` : "\n交互检查全过");
process.exit(problems.length ? 1 : 0);
