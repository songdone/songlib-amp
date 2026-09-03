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

/*
 * 支持跑在真部署上：SL_STATE 指向一份已登录的 storageState。
 * 之所以要这条 —— 只在自己写的 mock 上跑，永远发现不了真实数据带来的
 * 问题（真歌词有版权块、真封面有跨域、真曲库有几千条）。
 */
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  ...(process.env.SL_STATE ? { storageState: process.env.SL_STATE } : {}),
});
const page = await ctx.newPage();
page.on("pageerror", (e) => note(`未捕获异常：${e.message.slice(0, 120)}`));
page.on("console", (m) => m.type() === "error" && note(`控制台报错：${m.text().slice(0, 120)}`));

await page.addInitScript(() => localStorage.setItem("songlib-pwa-dismissed", "1"));
/*
 * 不能用 waitUntil:"networkidle"。
 *
 * 真部署上播放状态、健康检查一直在轮询，网络**永远不会空闲**，
 * 这里会直接超时 —— 这个假设只在 mock 上成立，而"只在 mock 上成立"
 * 正是这套检查要消灭的东西。
 * 改成等 DOM 就绪，再等一个真实存在的界面元素。
 */
await page.goto(BASE, { waitUntil: "domcontentloaded" });
/*
 * 必须等**可见**的导航按钮，而且不能把超时吞掉。
 *
 * 第一版写的是 `.first().waitFor().catch(()=>{})`：first() 选中的是
 * 侧栏里那个 .mobile-only 的"收起导航"，桌面宽度下它是隐藏的，
 * 永远等不到；catch 又把超时咽了，于是页面还没加载完就往下跑，
 * 报出"首页没有 .glow-follow"这种假问题 —— 比不检查更糟，
 * 因为它看起来像真的。
 */
await page
  .locator("nav button:visible, aside button:visible")
  .first()
  .waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);

// 同样必须限定 :visible —— 侧栏里有一批 .mobile-only 的按钮，桌面宽度下
// 隐藏但仍在 DOM 里，不加限定会点到它们然后一直等。
const nav = (label) =>
  page
    .locator("nav button:visible, aside button:visible")
    .filter({ hasText: label })
    .first()
    .click();

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
    const rows = [];
    for (let y = 0; y < c.height; y += 2) {
      /*
       * 用**相邻像素的最大跳变**判断这一行有没有内容，不用整行的
       * max-min。
       *
       * 整行 max-min 会被背景骗到：底色是 createLinearGradient(0,0,w,h)
       * 的对角渐变，靠近顶边的一行本身就有从左到右的颜色斜坡，
       * max-min 能到二三十，于是纯背景被判成内容 —— 阈值一降到 16
       * 就冒出来了（极简 1:1 的"首个内容"被报在 2% 处，那里什么都没有）。
       *
       * 相邻差不会：平滑渐变每一步只差零点几，而文字边缘、封面边界
       * 一步就跳几十。判据换成它，对角渐变多深都不影响。
       */
      let jump = 0;
      let sum = 0;
      let n = 0;
      let prevL = null;
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (prevL !== null) {
          const delta = Math.abs(l - prevL);
          if (delta > jump) jump = delta;
        }
        prevL = l;
        sum += l;
        n += 1;
      }
      rows.push({ contrast: jump, mean: sum / n });
    }

    /*
     * 一行算不算"有内容"，两条判据取或。
     *
     * 只看行内对比度（max-min）会漏掉深色实体：黑胶那张的唱片盘身是
     * 深色纹路压深色底，行内对比很低，于是整个唱片被判成空白，
     * 报成"画面正中裂开 28%" —— 而实际构图是对的。这条假阳性我一度
     * 打算忽略，但忽略等于以后真裂开了也不会报。
     *
     * 第二条判据：跟**背景渐变**比。底色是从上到下的平滑渐变，
     * 用首行和末行的平均亮度线性插值当参考；某一行明显偏离参考，
     * 说明那儿压着东西 —— 不管它自己内部对比高不高。
     */
    const head = rows[0]?.mean ?? 0;
    const tail = rows[rows.length - 1]?.mean ?? 0;
    for (let i = 0; i < rows.length; i += 1) {
      const ref = head + ((tail - head) * i) / Math.max(1, rows.length - 1);
      const offBackground = Math.abs(rows[i].mean - ref) > 6;
      /*
       * 阈值 7 是量出来的，不是拍的。改用相邻像素跳变之后，
       * 同一批海报实测：
       *   真空白行            1.0 – 3.0
       *   深色实体（唱片盘身）11.0 – 15.7   ← 靠唱片纹路的细线
       *   文字行              58 – 228
       * 7 落在前两簇中间，两边都有三倍余量。
       *
       * 阈值走过一段弯路，记下来免得再绕：42（整行 max-min）→ 看不见
       * 唱片，误报"正中裂开"；16 → 换成相邻跳变后仍在盘身之上，还是
       * 看不见。每次都是先量三类行的真实数值再定，不是试出来的。
       */
      filled.push(rows[i].contrast > 7 || offBackground);
    }
    /*
     * 底部那行小水印（SongLib Amp · 音屿）是页脚，不是内容。
     *
     * 把它算进来的话，正文结束到水印之间的空白会被当成"画面正中裂开" ——
     * 而任何一个把字放在上半部、底下留白的版式都会中招，极简 9:16
     * 被报成裂开 50%，但那正是它该有的样子。
     *
     * 所以"内容"的下界取最后一行**在页脚带以上**的内容；页脚带按画布
     * 底部 8% 算（水印字号是宽度的 2.2%，加上下边距远小于这个数）。
     */
    const footerBand = Math.round(filled.length * 0.92);
    const firstAt = filled.indexOf(true);
    let lastAt = -1;
    for (let i = Math.min(footerBand, filled.length) - 1; i >= 0; i -= 1) {
      if (filled[i]) { lastAt = i; break; }
    }
    if (lastAt < 0) lastAt = filled.lastIndexOf(true);
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
    /*
     * 阈值从 14% 放宽到 30%。
     *
     * 不是为了让检查变绿 —— 是因为 14% 会把刻意的留白式构图判成缺陷。
     * 「歌词」模板上方那一片"空白"里其实有个 0.16 不透明度的大引号，
     * 亮度探不到；导出真图看过，那个构图是成立的。为了满足 14% 去调它，
     * 只会把留白从上面搬到下面（试过一次，9:16 下方空 67%，更糟）。
     *
     * 留住的是真缺陷：一边几乎贴边、另一边空掉三分之一，
     * 或者画面正中裂开一段 —— 黑胶方版就是这么查出"专辑名压在底注上"的。
     */
    const skew = pc(Math.abs(gap.top - gap.bottom));
    const outer = Math.max(gap.top, gap.bottom, 1);
    const split = gap.hole > outer * 1.6 && pc(gap.hole) > 22;
    if (skew > 30)
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

/* ---------- 7. 指针跟随：光晕必须真的跟着动 ---------- */
console.log("\n指针跟随");
await nav("首页").catch(() => {});
await page.waitForTimeout(1000);
const hero = page.locator(".glow-follow").first();
if (!(await hero.count())) note("首页没有 .glow-follow 元素");
else {
  const box = await hero.boundingBox();
  const readVars = () =>
    page.evaluate(() => {
      const el = document.querySelector(".glow-follow");
      return {
        px: el.style.getPropertyValue("--px"),
        py: el.style.getPropertyValue("--py"),
        glow: getComputedStyle(el, "::before").opacity,
      };
    });
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.waitForTimeout(300);
  const a = await readVars();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7);
  await page.waitForTimeout(300);
  const c = await readVars();
  // 只有类名和渐变不算 —— 变量必须随指针变。曾经就是"光晕会亮但永远
  // 停在正中"：回调 ref 写成了 useRef 加空依赖的 effect，节点后出现就漏了。
  if (!a.px || !c.px) note("指针移动后 --px/--py 仍是空，跟随没生效");
  else if (a.px === c.px) note(`指针换了位置但 --px 没变（${a.px}），光晕不跟随`);
  else ok(`光晕跟随生效（--px ${a.px} → ${c.px}）`);
  if (Number(c.glow) < 0.5) note(`指针在元素上时光晕不可见（opacity ${c.glow}）`);
  else ok(`悬停时光晕可见（opacity ${Number(c.glow).toFixed(2)}）`);
}

/* ---------- 8. 重影边框：外壳和子元素画了两层一样的框 ---------- */
console.log("\n重影边框");
// 为什么要通用扫描而不是逐个页面看：这类缺陷的成因都一样 —— 页面级的
// 通用规则（.settings-page input:not(...) 那种，特异性能到 0,5,1）伸进
// 已经有外壳的组件里，外壳一层边框、控件再被加一层，两个同色同圆角的
// 边框叠在一起。人眼在小截图上很容易忽略，量像素才看得出。
const dupBorders = async (label) => {
  const found = await page.evaluate(() => {
    const same = (a, b) => a === b && a !== "0px" && !a.startsWith("0px");
    const out = [];
    for (const child of document.querySelectorAll("input, select, textarea, button")) {
      const parent = child.parentElement;
      if (!parent) continue;
      const cs = getComputedStyle(child);
      const ps = getComputedStyle(parent);
      const cb = cs.borderTopWidth + " " + cs.borderTopColor;
      const pb = ps.borderTopWidth + " " + ps.borderTopColor;
      if (!same(cs.borderTopWidth, ps.borderTopWidth)) continue;
      if (cs.borderTopColor !== ps.borderTopColor) continue;
      // 两个框几乎同尺寸才算重影：父元素明显更大时那是正常的容器
      const cr = child.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (pr.width - cr.width > 26 || pr.height - cr.height > 26) continue;
      if (cr.width < 40) continue;
      out.push(
        `${parent.tagName}.${(parent.className || "").slice(0, 22)} > ${child.tagName} 都是 ${cb}`,
      );
    }
    return [...new Set(out)].slice(0, 4);
  });
  if (found.length) found.forEach((item) => note(`${label} 重影边框：${item}`));
  else ok(`${label} 无重影边框`);
};
for (const [label, tab] of [["设置", null], ["下载入库", null], ["文件与标签", null]]) {
  await nav(label).catch(() => {});
  await page.waitForTimeout(900);
  await dupBorders(`${label}页`);
}
// Plex 弹窗是这类缺陷的原发地，单独开一次
await nav("设置").catch(() => {});
await page.waitForTimeout(700);
const plexTab = page.locator("button").filter({ hasText: "Plex 连接" }).first();
if (await plexTab.count()) {
  await plexTab.click();
  await page.waitForTimeout(600);
  const openPlex = page.getByRole("button", { name: /连接 Plex|配置|编辑/ }).first();
  if (await openPlex.count()) {
    await openPlex.click();
    await page.waitForTimeout(800);
    await dupBorders("Plex 弹窗");
    await page.keyboard.press("Escape");
  }
}

/* ---------- 9. 转场与滚动驱动 ---------- */
console.log("\n转场与滚动驱动");
await nav("首页").catch(() => {});
await page.waitForTimeout(900);
const vt = await page.evaluate(async () => {
  let called = false;
  const orig = document.startViewTransition?.bind(document);
  if (!orig) return { unsupported: true };
  document.startViewTransition = (cb) => {
    called = true;
    return orig(cb);
  };
  const btn = [...document.querySelectorAll("nav button, aside button")].find((b) =>
    b.textContent.includes("音乐库"),
  );
  btn?.click();
  await new Promise((r) => setTimeout(r, 700));
  document.startViewTransition = orig;
  return { called };
});
if (vt.unsupported) console.log("  — 该浏览器不支持 View Transitions");
else if (!vt.called) note("切页没有走 View Transitions，转场退化成了旧页面瞬间消失");
else ok("切页走了 View Transitions");

await nav("首页").catch(() => {});
await page.waitForTimeout(900);
const para = await page.evaluate(async () => {
  if (!CSS.supports("animation-timeline: scroll()")) return { unsupported: true };
  const el = document.querySelector(".home-hero__bleed");
  if (!el) return { missing: true };
  const read = () => ({
    translate: getComputedStyle(el).translate,
    transform: getComputedStyle(el).transform,
  });
  const before = read();
  window.scrollTo(0, 420);
  await new Promise((r) => setTimeout(r, 500));
  const after = read();
  window.scrollTo(0, 0);
  return { before, after };
});
if (para.unsupported) console.log("  — 该浏览器不支持滚动驱动动画");
else if (para.missing) note("找不到 .home-hero__bleed");
else if (para.before.translate === para.after.translate)
  // 这条守两个真踩过的坑：scroll(nearest) 解析不到滚动容器时整条动画
  // 静默不激活；以及关键帧写 transform 会把元素原有的 scale 顶掉。
  note(`滚动了 420px 但视差没动（translate 一直是 ${para.before.translate}）`);
else if (para.before.transform !== para.after.transform)
  note("视差把元素原有的 transform 顶掉了，应该只动 translate");
else ok(`视差生效（translate ${para.before.translate} → ${para.after.translate}，scale 保住）`);

/* ---------- 10. 竖排列表里的图标要在同一条线上 ---------- */
console.log("\n图标对齐");
// 成因是同一类：更广的按钮规则把【图标+文字】当整体居中，文字长度不同
// 图标就被推到不同位置。按钮本身宽度、左边界都一样，歪的只有里面的内容，
// 所以量按钮量不出来，必须量图标。
const iconLines = async (label, selector) => {
  const off = await page.evaluate((sel) => {
    const box = document.querySelector(sel);
    if (!box) return null;
    const out = [];
    for (const btn of box.querySelectorAll("button, a")) {
      const svg = btn.querySelector("svg");
      if (!svg) continue;
      out.push(Math.round(svg.getBoundingClientRect().left - box.getBoundingClientRect().left));
    }
    return out;
  }, selector);
  if (!off || off.length < 3) return;
  const spread = Math.max(...off) - Math.min(...off);
  if (spread > 2) note(`${label} 图标不在一条线上，左边界相差 ${spread}px（${[...new Set(off)].join("/")}）`);
  else ok(`${label} 图标对齐（${off[0]}px）`);
};
await nav("设置").catch(() => {});
await page.waitForTimeout(900);
await iconLines("设置二级导航", ".settings-tabs");
await iconLines("主侧栏", "aside nav");

/* ---------- 11. 手机上必须够得到全屏歌词 ---------- */
console.log("\n移动端");
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  ...(process.env.SL_STATE ? { storageState: process.env.SL_STATE } : {}),
});
const mp = await mobile.newPage();
await mp.addInitScript(() => localStorage.setItem("songlib-pwa-dismissed", "1"));
await mp.goto(BASE, { waitUntil: "domcontentloaded" });
await mp.waitForTimeout(2500);
const mplay = mp.getByRole("button", { name: /播放这张专辑/ }).first();
if (await mplay.count()) {
  await mplay.click();
  await mp.waitForTimeout(900);
}
await mp
  .locator("nav button:visible, aside button:visible")
  .filter({ hasText: "播放" })
  .first()
  .click()
  .catch(() => {});
await mp.waitForTimeout(1600);
// 只量"初始是否在视口内"是错的：竖排长页面本来就要滚。
// 要测的是能不能滚到、滚到之后有没有被迷你播放器或底栏挡住、点了有没有反应。
const mobileFull = mp.getByRole("button", { name: /全屏歌词/ }).first();
if (!(await mobileFull.count())) note("手机上找不到「全屏歌词」入口");
else {
  try {
    await mobileFull.scrollIntoViewIfNeeded({ timeout: 6000 });
    await mp.waitForTimeout(400);
    const hit = await mp.evaluate(() => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("全屏歌词"),
      );
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        inView: r.top >= 0 && r.bottom <= window.innerHeight,
        blocked: !(top === el || el.contains(top)),
        by: top ? `${top.tagName}.${(top.className || "").slice(0, 24)}` : "null",
      };
    });
    if (!hit.inView) note("「全屏歌词」滚动之后仍不在视口内");
    else if (hit.blocked) note(`「全屏歌词」被 ${hit.by} 挡住`);
    else {
      await mobileFull.click({ timeout: 6000 });
      await mp.waitForTimeout(900);
      const opened = await mp.evaluate(() => !!document.querySelector(".now-lyrics-overlay"));
      if (!opened) note("手机上点了「全屏歌词」没有打开");
      else ok("手机上能滚到并打开全屏歌词");
    }
  } catch (err) {
    note(`手机上够不到「全屏歌词」：${String(err.message).slice(0, 60)}`);
  }
}
/* ---------- 12. 迷你条不许压住底栏，而且必须能收起 ---------- */
/*
 * 这条守卫的由来：用户报"迷你播放条遮住底栏导航，且关不掉"。
 * CDP 问出来的胜出规则是 legacy.protected 层的 `.mini-player{bottom:78px}`，
 * 它无视特异性压掉了带 env(safe-area-inset-bottom) 的版本。
 * 无头浏览器安全区恒为 0，**所以只量真实间距是量不出这个 bug 的** ——
 * 必须把安全区注入进去再量。
 */
/* 用应用内导航离开播放页 —— 播放页本身不显示迷你条（showMiniPlayer 的条件）。
   不能用 goto：整页重载会把内存里的播放状态丢掉，迷你条就不出现了，
   于是这条守卫每次都以"量不到"收场，看起来像通过了。 */
await mp
  .locator("nav button:visible")
  .filter({ hasText: "曲库" })
  .first()
  .click()
  .catch(() => {});
for (let i = 0; i < 15; i += 1) {
  await mp.waitForTimeout(800);
  const ready = await mp
    .evaluate(() => !!document.querySelector(".mini-player") && !!document.querySelector(".mobile-nav"))
    .catch(() => false);
  if (ready) break;
}

const geometry = () =>
  mp.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    return {
      mini: box(".mini-player"),
      nav: box(".mobile-nav"),
      navVar: getComputedStyle(document.documentElement).getPropertyValue("--mobile-nav-height").trim(),
      miniVar: getComputedStyle(document.documentElement).getPropertyValue("--mini-player-height").trim(),
      vw: window.innerWidth,
    };
  });

const before = await geometry();
if (!before.mini || !before.nav) {
  note("手机上量不到迷你条或底栏（没有在放歌？）");
} else {
  if (!before.navVar || before.navVar === "0px")
    note("底栏没有把真实高度写进 --mobile-nav-height，迷你条的偏移又会退回写死值");
  else ok(`底栏真实高度已发布：${before.navVar}`);

  if (before.mini.bottom > before.nav.top)
    note(`迷你条压住底栏 ${before.mini.bottom - before.nav.top}px`);
  else ok(`迷你条与底栏净空 ${before.nav.top - before.mini.bottom}px`);

  /* 展开态是一个居中胶囊，左右必须对称；而且不许有任何一边跑到屏幕外
     —— left 变负数就是 legacy 的 transform:translateX(-50%) 没清干净
     （我自己踩过一次，量出 left:-157）。 */
  const rightGap = before.vw - before.mini.right;
  if (before.mini.left < 0 || rightGap < 0)
    note(`迷你条跑出屏幕：左 ${before.mini.left} / 右 ${rightGap}`);
  else if (Math.abs(before.mini.left - rightGap) > 4)
    note(`迷你条左右不对称：左 ${before.mini.left} / 右 ${rightGap}`);
  else ok(`迷你条左右对称（各 ${before.mini.left}）`);
}

/*
 * 把安全区补上再验一遍。env() 不能直接改，但底栏和迷你条现在都是
 * 按"量出来的真实高度"算偏移的 —— 所以只要把底栏撑高，迷你条就该
 * 自己往上让。撑高用 padding-bottom 模拟 iPhone 的 34px 安全区。
 */
await mp.evaluate(() => {
  const nav = document.querySelector(".mobile-nav");
  if (nav) nav.style.paddingBottom = "34px";
});
await mp.waitForTimeout(700);
const withInset = await geometry();
if (withInset.mini && withInset.nav) {
  if (withInset.mini.bottom > withInset.nav.top)
    note(`补上 34px 安全区后迷你条压住底栏 ${withInset.mini.bottom - withInset.nav.top}px（真 iPhone 上就是这个）`);
  else ok(`安全区 34px 下净空仍有 ${withInset.nav.top - withInset.mini.bottom}px`);
}
await mp.evaluate(() => {
  const nav = document.querySelector(".mobile-nav");
  if (nav) nav.style.paddingBottom = "";
});
await mp.waitForTimeout(500);

// 收起：点了要真的变窄，而且歌不能停 —— 收起不是停止播放。
const collapse = mp.getByRole("button", { name: /收起播放条/ }).first();
if (!(await collapse.count())) {
  note("手机上迷你条没有收起按钮（想让它别挡路只能把歌关掉）");
} else {
  const wideBefore = (await geometry()).mini;
  const playingBefore = await mp.evaluate(() => {
    const a = document.querySelector("audio");
    return a ? !a.paused : null;
  });
  await collapse.click();
  await mp.waitForTimeout(900);
  const after = await geometry();
  const stillHasTrack = await mp.evaluate(() => !!document.querySelector(".mini-player"));
  if (!stillHasTrack) note("收起把迷你条整个弄没了（应该只是缩小）");
  else if (!after.mini || after.mini.right - after.mini.left >= wideBefore.right - wideBefore.left)
    note("点了收起，迷你条宽度没变");
  else ok(`收起后宽度 ${wideBefore.right - wideBefore.left} → ${after.mini.right - after.mini.left}`);
  const playingAfter = await mp.evaluate(() => {
    const a = document.querySelector("audio");
    return a ? !a.paused : null;
  });
  if (playingBefore && !playingAfter) note("收起播放条把歌也停了");

  // 展开要能回去，并且刷新之后收起状态得记住。
  const expand = mp.getByRole("button", { name: /展开播放条/ }).first();
  if (!(await expand.count())) note("收起之后找不到展开按钮，收起是个单向门");
  else {
    await mp.reload({ waitUntil: "domcontentloaded" });
    await mp.waitForTimeout(3500);
    const afterReload = await mp
      .evaluate(() => ({
        hasMini: !!document.querySelector(".mini-player"),
        collapsed: !!document.querySelector(".mini-player--collapsed"),
      }))
      .catch(() => ({ hasMini: false, collapsed: false }));
    // 刷新后没有恢复播放状态时这条测不了（mock 的 player/state 不落盘），
    // 不能当成失败 —— 否则真问题会被这条假失败盖住。
    if (!afterReload.hasMini) console.log("  —", "刷新后没恢复播放，收起状态这条跳过");
    else if (!afterReload.collapsed) note("刷新之后收起状态没记住，每次进来都要再收一次");
    else ok("收起状态刷新后保持");
    const expandAgain = mp.getByRole("button", { name: /展开播放条/ }).first();
    if (await expandAgain.count()) {
      await expandAgain.click();
      await mp.waitForTimeout(800);
      const back = await geometry();
      if (back.mini && back.mini.right - back.mini.left > 200) ok("展开回到完整条");
      else note("点了展开没有恢复成完整条");
    }
  }
}

/* ---------- 13. 首页 hero 封面窄屏必须居中 ---------- */
await mp.goto(BASE, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 15; i += 1) {
  await mp.waitForTimeout(1000);
  const ready = await mp.evaluate(() => !!document.querySelector(".home-hero__art")).catch(() => false);
  if (ready) break;
}
const heroBox = await mp
  .evaluate(() => {
    const hero = document.querySelector(".home-hero");
    const art = document.querySelector(".home-hero__art");
    const copy = document.querySelector(".home-hero__copy");
    if (!hero || !art) return null;
    const h = hero.getBoundingClientRect();
    const a = art.getBoundingClientRect();
    const cs = getComputedStyle(hero);
    const inner = {
      left: h.left + parseFloat(cs.paddingLeft),
      right: h.right - parseFloat(cs.paddingRight),
    };
    return {
      leftGap: Math.round(a.left - inner.left),
      rightGap: Math.round(inner.right - a.right),
      innerWidth: Math.round(inner.right - inner.left),
      copyWidth: copy ? Math.round(copy.getBoundingClientRect().width) : null,
    };
  })
  .catch(() => null);
if (!heroBox) note("首页量不到 hero 封面");
else {
  // 差 4px 以内算居中（子像素舍入）。改之前实测是左 21 / 右 119。
  if (Math.abs(heroBox.leftGap - heroBox.rightGap) > 4)
    note(`首页 hero 封面没居中：左 ${heroBox.leftGap} / 右 ${heroBox.rightGap}`);
  else ok(`首页 hero 封面居中（左右各 ${heroBox.leftGap}）`);
  // justify-items:start 会连带把文字列也缩到内容宽，标题白白提前折行。
  if (heroBox.copyWidth !== null && heroBox.innerWidth - heroBox.copyWidth > 8)
    note(`hero 文字列只有 ${heroBox.copyWidth}px，没吃满 ${heroBox.innerWidth}px（justify-items 把子项收缩了）`);
  else ok("hero 文字列吃满整列");
}

await mobile.close();

/* ---------- 14. PWA：安装事件必须在 React 之前就被接住 ---------- */
/*
 * 「Chrome/Edge 没装过也不弹窗」的根因是监听时机：`beforeinstallprompt`
 * 只发一次、而且发得很早，原来的监听器却注册在 PwaInstallPrompt 的
 * useEffect 里 —— 那个组件只在登录之后才挂载，等它挂上来事件早过去了。
 * manifest 一直是合规的。
 *
 * 这条守卫在页面刚开始加载时就把事件发出去，然后看应用有没有接住。
 * 只截首屏是测不出这个的：事件在"能看见界面"之前就已经发生了。
 */
console.log("\nPWA 安装");
const pwaCtx = await browser.newContext({
  ...(process.env.SL_STATE ? { storageState: process.env.SL_STATE } : {}),
});
const pp = await pwaCtx.newPage();
await pp.addInitScript(() => {
  // 伪造一个 beforeinstallprompt，在文档刚开始解析时就派发 ——
  // 比 React 挂载早得多，正是 Chrome 真实的时机。
  window.__slPromptPrevented = false;
  window.__slPromptCalled = false;
  const fake = new Event("beforeinstallprompt");
  fake.preventDefault = () => {
    window.__slPromptPrevented = true;
  };
  fake.prompt = async () => {
    window.__slPromptCalled = true;
  };
  Object.defineProperty(fake, "userChoice", {
    value: Promise.resolve({ outcome: "accepted" }),
  });
  /*
   * 派发时机要贴住 Chrome 的真实行为：load 之后不久。
   *
   * 不能用 readyState==="interactive" —— 打包出来的入口是
   * <script type="module">，它是 defer 的，在 interactive **之后**才执行，
   * 那样连模块级的捕获都接不到，测的就不是"监听时机"这件事了。
   * load 之后派发才落在真正的失败窗口里：模块级捕获（文档解析完就装好）
   * 接得到，而挂在登录后组件里的监听器（还要几秒才挂载）接不到。
   */
  window.addEventListener("load", () => setTimeout(() => window.dispatchEvent(fake), 200));
});
await pp.goto(BASE, { waitUntil: "domcontentloaded" });
await pp.waitForTimeout(4000);

const captureReady = await pp
  .evaluate(() => document.documentElement.dataset.songlibInstallCapture)
  .catch(() => "");
if (captureReady !== "ready") note(`安装事件捕获仓没装好（dataset=${captureReady || "无"}）`);
else ok("安装事件捕获仓在 React 之前就绪");

const prevented = await pp.evaluate(() => window.__slPromptPrevented).catch(() => false);
if (!prevented)
  note("没有 preventDefault：Chrome 会改用自己的迷你信息栏，之后就调不出 prompt() 了");
else ok("安装事件已被接住并 preventDefault");

// 接住了就必须表现为"能装"：按钮写「安装应用」，点了真的调 prompt()。
const installBtn = pp.getByRole("button", { name: /^安装应用$/ }).first();
if (!(await installBtn.count())) {
  const label = await pp
    .evaluate(() => {
      const aside = document.querySelector(".pwa-prompt");
      return aside ? aside.innerText.replace(/\n+/g, " | ").slice(0, 120) : "没有提示条";
    })
    .catch(() => "读不到");
  note(`事件已接住但按钮没变成「安装应用」：${label}`);
} else {
  ok("按钮显示「安装应用」");
  await installBtn.click();
  await pp.waitForTimeout(700);
  const called = await pp.evaluate(() => window.__slPromptCalled).catch(() => false);
  if (!called) note("点了「安装应用」没有真的调 prompt()");
  else ok("点了「安装应用」真的调起了 prompt()");
}
await pwaCtx.close();

await browser.close();
console.log(problems.length ? `\n发现 ${problems.length} 个问题` : "\n交互检查全过");
process.exit(problems.length ? 1 : 0);
