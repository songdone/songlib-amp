/**
 * 分享海报的绘制引擎。
 *
 * 为什么自己画 canvas，而不是 html2canvas 之类：
 *
 * 1. 不加依赖。html2canvas 会把 DOM 重新实现一遍 CSS 布局，
 *    对 mask-image、backdrop-filter、color-mix 这些项目里用得很多的
 *    属性支持都不完整 —— 导出的图跟屏幕上不一样，那比不导出更糟。
 * 2. 海报是固定构图：一张封面、几行字、一条底注。这种东西手画 canvas
 *    是最省事的，还能精确控制字距和行距。
 * 3. 导出要 2~3 倍图。canvas 直接按倍数放大画就行，
 *    DOM 截图方案在高倍下经常出现文字位移。
 *
 * 这个文件只做纯计算和绘制，不碰 React。可测的部分（换行、取色、
 * 歌词裁剪）都是导出的纯函数，见 tests/poster.test.mjs。
 */

/** 画布尺寸。宽度固定 1080，高度按比例算 —— 1080 是各平台通用的分享宽度。 */
// 显式带 .js：poster.js 会被 node --test 直接加载，Node 的 ESM 解析
// 不做无扩展名补全（Vite 会，所以只在测试里炸）。
import { isCreditLine } from "./lyrics.js";

export const RATIOS = Object.freeze({
  "3:4": { label: "3:4 竖版", width: 1080, height: 1440 },
  "9:16": { label: "9:16 全屏", width: 1080, height: 1920 },
  "1:1": { label: "1:1 方版", width: 1080, height: 1080 },
});

export const TEMPLATES = Object.freeze({
  duet: { label: "封面歌词", note: "封面在上、歌词在下，两样都要" },
  cover: { label: "专辑", note: "大封面压在正中，信息收在下方" },
  lyric: { label: "歌词", note: "歌词是主角，封面退成背景" },
  vinyl: { label: "黑胶", note: "封面切成唱片，配唱针与纹路" },
  polaroid: { label: "拍立得", note: "白边相纸，下方留一行手写位" },
  minimal: { label: "极简", note: "只有字和一条细线" },
});

/* =================================================================
 * 取色
 * ================================================================= */

/**
 * 从封面里取一组配色。
 *
 * 做法：缩到 24×24 画进离屏 canvas，把像素按色相分桶，
 * 取"够饱和、又不太暗"的最大桶做主色。
 *
 * 为什么不用平均色：平均色永远是灰褐色。一张以红色为主、
 * 带黑边的封面，平均下来是暗红棕；按桶取众数才能拿到那个红。
 *
 * @returns {{accent:[number,number,number], ink:string, dark:boolean}}
 */
export function paletteFromImage(image) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);

  let data;
  try {
    data = context.getImageData(0, 0, size, size).data;
  } catch {
    // 跨域图片会污染画布，getImageData 直接抛。退回默认暖金。
    return { accent: [227, 180, 89], ink: "#f5f2ec", dark: true };
  }

  // 12 个色相桶，各自累计权重和 RGB 和。
  const buckets = Array.from({ length: 12 }, () => ({
    weight: 0,
    r: 0,
    g: 0,
    b: 0,
  }));
  let luminanceSum = 0;
  let counted = 0;

  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    luminanceSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    counted += 1;

    const saturation = max === 0 ? 0 : (max - min) / max;
    // 太灰、太黑、太白的像素不参与选主色 —— 它们决定的是明暗，不是色调。
    if (saturation < 0.22 || max < 46 || min > 226) continue;

    const hue = hueOf(r, g, b, max, min);
    const bucket = buckets[Math.min(11, Math.floor(hue / 30))];
    // 权重给饱和度，让浓的像素更有话语权。
    const weight = saturation * saturation;
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }

  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  const accent = best.weight
    ? [
        Math.round(best.r / best.weight),
        Math.round(best.g / best.weight),
        Math.round(best.b / best.weight),
      ]
    : [227, 180, 89];

  const dark = counted ? luminanceSum / counted < 0.52 : true;
  return { accent: liftForDarkBackground(accent), ink: dark ? "#f5f2ec" : "#16181d", dark };
}

function hueOf(r, g, b, max, min) {
  const delta = max - min;
  if (!delta) return 0;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/**
 * 主色永远画在深底上，太暗的主色会看不见。
 * 相对亮度低于 0.3 就整体提亮，色相不动。
 */
function liftForDarkBackground([r, g, b]) {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance >= 0.3) return [r, g, b];
  const factor = 0.3 / Math.max(luminance, 0.02);
  return [
    Math.min(255, Math.round(r * factor)),
    Math.min(255, Math.round(g * factor)),
    Math.min(255, Math.round(b * factor)),
  ];
}

export const rgb = ([r, g, b], alpha = 1) =>
  alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;

/* =================================================================
 * 排版
 * ================================================================= */

/**
 * 按宽度折行。
 *
 * 中英混排必须按**字符**试，不能按空格分词 —— 中文没有空格，
 * 按词分会整段不折，直接溢出画布。
 * 但拉丁词又不该被从中间劈开，所以遇到 ASCII 单词时整词试。
 *
 * @param measure 量一段文字宽度的函数（通常是 ctx.measureText）
 */
export function wrapText(text, maxWidth, measure, maxLines = Infinity) {
  const source = String(text || "").trim();
  if (!source) return [];

  const chunks = source.match(/[A-Za-z0-9'’\-.]+|\s+|[^\s]/g) || [];
  const lines = [];
  let line = "";

  for (const chunk of chunks) {
    if (/^\s+$/.test(chunk)) {
      // 行首的空白丢掉，行内的空白保留成一个空格。
      if (line) line += " ";
      continue;
    }
    const candidate = line + chunk;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line.trimEnd());
      if (lines.length >= maxLines) return clampLast(lines, maxLines, measure, maxWidth);
      line = chunk;
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length > maxLines
    ? clampLast(lines.slice(0, maxLines), maxLines, measure, maxWidth)
    : lines;
}

/** 超出行数时，最后一行末尾加省略号，并保证加了之后还是不超宽。 */
function clampLast(lines, maxLines, measure, maxWidth) {
  const out = lines.slice(0, maxLines);
  let last = out[out.length - 1] || "";
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  out[out.length - 1] = `${last.trimEnd()}…`;
  return out;
}

/**
 * 从解析好的歌词里挑出可以上海报的行。
 *
 * 规则：
 * - 去掉纯符号行（"♪"）和元信息行（"作词：""编曲："）。
 * - 去掉重复行 —— 副歌在 LRC 里会出现四五次，海报上重复没有意义。
 * - 太长的行不要（超过 34 字塞进海报只能缩到看不清）。
 */
export function shareableLyricLines(lines = []) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const text = String(line?.text || "").trim();
    if (!text || text === "♪") continue;
    // 判据集中在 lib/lyrics.js。原来这里自己写了一份，只认「作词」不认
    // 「词」，于是「词：TE DI」「曲：TE DI/SOL」这类简写全漏了。
    if (isCreditLine(text)) continue;
    if (text.length > 34) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ time: line.time, text });
  }
  return out;
}

/* =================================================================
 * 绘制
 * ================================================================= */

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif';

const font = (weight, size) => `${weight} ${size}px ${FONT_STACK}`;

/**
 * 排一段文字，返回它占的高度，不画。
 *
 * 为什么需要"先量后画"：canvas 的 fillText 用的是基线坐标，
 * 而版式要按"这块占多高"来排。之前极简模板直接用 height 的百分比
 * 当间距，结果 NOW PLAYING 和曲名叠在了一起 —— 一个 97px 的标题，
 * 上一行只留了 79px 间距。现在间距一律从实际字号推出来。
 */
function layoutText(context, text, options) {
  const { weight = 400, size, maxWidth, maxLines = 1, leading = 1.16 } = options;
  context.font = font(weight, size);
  const lines = wrapText(text, maxWidth, (value) => context.measureText(value).width, maxLines);
  return {
    lines,
    size,
    weight,
    lineHeight: Math.round(size * leading),
    // 第一行基线离块顶的距离。0.8 是 CJK 字面的近似上伸比例。
    firstBaseline: Math.round(size * 0.8),
    /*
     * 块高必须算到**下伸部分的底**，不能停在最后一行的基线。
     *
     * 第一版写的是 size * 0.8（只到基线），于是下一块的顶紧贴着
     * 上一块最后一行的基线 —— "海阔天空 / Beyond / 乐与怒" 三行
     * 挤成一坨，中间几乎没有空隙。加上 0.24 的下伸余量之后，
     * 块与块之间的间距才是眼睛看到的间距。
     */
    height: lines.length
      ? Math.round(size * 1.04 + (lines.length - 1) * size * leading)
      : 0,
  };
}

/** 画 layoutText 的结果。y 是这块的**顶部**，不是基线。 */
function paintText(context, block, x, y, fillStyle, align = "left") {
  if (!block.lines.length) return y;
  context.save();
  context.font = font(block.weight, block.size);
  context.fillStyle = fillStyle;
  context.textAlign = align;
  let baseline = y + block.firstBaseline;
  for (const line of block.lines) {
    context.fillText(line, x, baseline);
    baseline += block.lineHeight;
  }
  context.restore();
  return y + block.height;
}

/**
 * 画一张海报。
 *
 * @param canvas   目标画布
 * @param options.scale  导出倍数。预览用 1，下载用 2。
 * @returns 实际用到的配色，供 UI 同步主题
 */
export function drawPoster(canvas, options) {
  const {
    template = "cover",
    ratio = "3:4",
    title = "",
    artist = "",
    album = "",
    lyrics = [],
    image = null,
    footer = "",
    scale = 1,
    palette,
  } = options || {};

  const size = RATIOS[ratio] || RATIOS["3:4"];
  canvas.width = size.width * scale;
  canvas.height = size.height * scale;
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.textBaseline = "alphabetic";

  const theme = palette || (image ? paletteFromImage(image) : null) || {
    accent: [227, 180, 89],
    ink: "#f5f2ec",
    dark: true,
  };

  const frame = { width: size.width, height: size.height, pad: Math.round(size.width * 0.085) };

  // 拍立得是浅底，自己从头画，不叠那层深色渐变。
  if (template !== "polaroid") paintBackground(context, frame, theme, image, template);

  const data = { title, artist, album, lyrics, image, footer };
  if (template === "cover") paintCoverTemplate(context, frame, theme, data);
  else if (template === "duet") paintDuetTemplate(context, frame, theme, data);
  else if (template === "lyric") paintLyricTemplate(context, frame, theme, data);
  else if (template === "vinyl") paintVinylTemplate(context, frame, theme, data);
  else if (template === "polaroid") paintPolaroidTemplate(context, frame, theme, data);
  else paintMinimalTemplate(context, frame, theme, data);

  return theme;
}

/** 底：主色深化的斜向渐变 + 一层颗粒，避免大面积纯色显得廉价。 */
function paintBackground(context, frame, theme, image, template) {
  const { width, height } = frame;
  const [r, g, b] = theme.accent;

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `rgb(${Math.round(r * 0.3)} ${Math.round(g * 0.3)} ${Math.round(b * 0.32)})`);
  gradient.addColorStop(0.55, "rgb(16 17 21)");
  gradient.addColorStop(1, "rgb(10 11 14)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // 歌词模板：封面糊成背景，让文字有质感但读得清。
  if (template === "lyric" && image) {
    context.save();
    context.globalAlpha = 0.34;
    context.filter = "blur(48px) saturate(1.5)";
    drawImageCover(context, image, -60, -60, width + 120, height + 120);
    context.restore();

    const scrim = context.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, "rgb(8 9 12 / 0.58)");
    scrim.addColorStop(0.5, "rgb(8 9 12 / 0.74)");
    scrim.addColorStop(1, "rgb(8 9 12 / 0.9)");
    context.fillStyle = scrim;
    context.fillRect(0, 0, width, height);
  }

  // 顶部一道主色光晕。
  const halo = context.createRadialGradient(width * 0.5, -height * 0.1, 0, width * 0.5, -height * 0.1, height * 0.62);
  halo.addColorStop(0, rgb(theme.accent, 0.3));
  halo.addColorStop(1, rgb(theme.accent, 0));
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);

  paintGrain(context, frame);
}

/**
 * 颗粒。
 *
 * 用固定的伪随机序列而不是 Math.random —— 同一首歌重复导出要得到
 * 一模一样的图，否则用户会以为自己点错了。
 */
function paintGrain(context, frame) {
  const { width, height } = frame;
  let seed = 20260902;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  context.save();
  context.globalAlpha = 0.045;
  context.fillStyle = "#ffffff";
  const count = Math.round((width * height) / 900);
  for (let index = 0; index < count; index += 1) {
    context.fillRect(next() * width, next() * height, 1, 1);
  }
  context.restore();
}

/** object-fit: cover 的等价实现。 */
function drawImageCover(context, image, x, y, width, height) {
  const source = image.naturalWidth / image.naturalHeight;
  const target = width / height;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;
  if (source > target) sw = image.naturalHeight * target;
  else sh = image.naturalWidth / target;
  context.drawImage(
    image,
    (image.naturalWidth - sw) / 2,
    (image.naturalHeight - sh) / 2,
    sw,
    sh,
    x,
    y,
    width,
    height,
  );
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** 缺封面时的兜底方块：主色渐变 + 标题首字。跟 Cover 组件同一个思路。 */
function paintCoverFallback(context, x, y, size, theme, title) {
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, rgb(theme.accent, 0.42));
  gradient.addColorStop(1, "rgb(22 24 29)");
  context.fillStyle = gradient;
  context.fill();
  const initial = String(title || "").trim().slice(0, 1).toUpperCase();
  if (!initial) return;
  context.save();
  context.fillStyle = rgb(theme.accent, 0.72);
  context.font = font(700, size * 0.34);
  context.textAlign = "center";
  context.fillText(initial, x + size / 2, y + size / 2 + size * 0.12);
  context.restore();
}

/** 底注。四个模板共用，位置一致。 */
function paintFooter(context, frame, theme, text) {
  if (!text) return;
  const { width, height, pad } = frame;
  context.save();
  context.font = font(500, Math.round(width * 0.0235));
  context.fillStyle = rgb(theme.accent, 0.62);
  context.textAlign = "center";
  context.fillText(text, width / 2, height - pad * 0.72);
  context.restore();
}

/** 主色小横线，用作分隔。 */
function paintRule(context, x, y, length, theme) {
  context.save();
  context.strokeStyle = rgb(theme.accent, 0.85);
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + length, y);
  context.stroke();
  context.restore();
}

/* --- 模板一：专辑 --- */

function paintCoverTemplate(context, frame, theme, data) {
  const { width, height, pad } = frame;
  const coverSize = width - pad * 2;

  // 先把下半部分的文字量出来，再决定封面放多高 ——
  // 长标题会折两行，封面就得往上挪，否则底注被顶掉。
  const title = layoutText(context, data.title, {
    weight: 700,
    size: Math.round(width * 0.072),
    maxWidth: coverSize,
    maxLines: 2,
  });
  const artist = layoutText(context, data.artist || "未知歌手", {
    weight: 500,
    size: Math.round(width * 0.036),
    maxWidth: coverSize,
  });
  const album = data.album
    ? layoutText(context, data.album, {
        weight: 400,
        size: Math.round(width * 0.028),
        maxWidth: coverSize,
      })
    : null;

  const ruleGap = Math.round(width * 0.05);
  const textHeight =
    ruleGap +
    title.height +
    Math.round(width * 0.03) +
    artist.height +
    (album ? Math.round(width * 0.022) + album.height : 0);
  const footerBand = Math.round(pad * 1.5);
  const coverY = Math.max(
    pad,
    Math.round((height - footerBand - textHeight - coverSize) / 2),
  );

  // 投影。之前这一段建好了路径、设好了 shadow，却漏了 fill()，
  // 所以整块是空操作 —— 封面一直没有投影。
  context.save();
  context.shadowColor = "rgb(0 0 0 / 0.55)";
  context.shadowBlur = 64;
  context.shadowOffsetY = 26;
  roundRect(context, pad, coverY, coverSize, coverSize, 28);
  context.fillStyle = "rgb(0 0 0)";
  context.fill();
  context.restore();

  context.save();
  roundRect(context, pad, coverY, coverSize, coverSize, 28);
  context.clip();
  if (data.image) drawImageCover(context, data.image, pad, coverY, coverSize, coverSize);
  else paintCoverFallback(context, pad, coverY, coverSize, theme, data.title);
  context.restore();

  let y = coverY + coverSize + ruleGap;
  paintRule(context, pad, y - Math.round(ruleGap * 0.5), Math.round(width * 0.11), theme);

  y = paintText(context, title, pad, y, theme.ink);
  y = paintText(context, artist, pad, y + Math.round(width * 0.022), rgb(theme.accent, 0.95));
  if (album) {
    paintText(context, album, pad, y + Math.round(width * 0.014), "rgb(255 255 255 / 0.46)");
  }

  paintFooter(context, frame, theme, data.footer);
}

/* --- 模板二：歌词 --- */

/**
 * 找一个能让每句歌词都排进**一行**的字号。
 *
 * 为什么值得专门做：歌词一折行就会掉出孤字。之前
 * "原谅我这一生不羁放纵爱自由" 在 92px 下折成两行，
 * 第二行只有一个"由"字，而且它和下一句的行距一样宽，
 * 于是三句歌词读起来像四句。
 *
 * 从大往小试，找到第一个全部单行的字号就停。
 * 试到下限还是排不下（超长句），就接受折行 —— 但那时字号已经很小，
 * 折出来的第二行不会只剩一个字。
 */
/**
 * 封面歌词：封面在上、歌词在下。
 *
 * 加这个模板是因为原来四个里没有一个能同时给封面和歌词 —— 想发歌词
 * 就只能让封面糊成背景。而分享一句歌词的时候，那张封面本身也是内容。
 *
 * 顺带解决 9:16 顶部大片空白：lyric 模板把歌词块在整幅画面里居中，
 * 画布越高、上下空得越多（9:16 时上方有 800 多像素只放着一个引号）。
 * 这里封面高度按剩余空间算，多出来的高度被封面吃掉，不会变成空白。
 */
function paintDuetTemplate(context, frame, theme, data) {
  const { width, height, pad } = frame;
  const maxWidth = width - pad * 2;
  const lines = (data.lyrics || []).filter(Boolean).slice(0, 4);

  // 底部：曲名 + 歌手。先量出来，中间才知道剩多少。
  const title = layoutText(context, data.title, {
    weight: 700,
    size: Math.round(width * 0.055),
    maxWidth,
    maxLines: 2,
  });
  const artist = layoutText(context, data.artist || "未知歌手", {
    weight: 500,
    size: Math.round(width * 0.032),
    maxWidth,
  });
  const footBottom = height - Math.round(pad * 1.5);
  const textTop = footBottom - artist.height - Math.round(width * 0.022) - title.height;

  // 歌词块：字号按句数给，量出真实高度。
  const lyricSize = lines.length
    ? fitLyricSize(
        context,
        lines,
        maxWidth,
        Math.round(width * (lines.length <= 2 ? 0.056 : 0.046)),
        Math.round(width * 0.03),
      )
    : 0;
  const lineHeight = Math.round(lyricSize * 1.58);
  context.font = font(600, lyricSize || 1);
  const wrapped = lines.length
    ? lines.flatMap((line) =>
        wrapText(line, maxWidth, (text) => context.measureText(text).width, 2),
      )
    : [];
  const lyricHeight = wrapped.length
    ? (wrapped.length - 1) * lineHeight + Math.round(lyricSize * 0.9)
    : 0;

  const lyricGap = wrapped.length ? Math.round(width * 0.055) : 0;
  // 封面吃掉剩下的全部高度，最多做到正方形 —— 再高就变形了。
  const available = textTop - pad - lyricHeight - lyricGap - Math.round(width * 0.05);
  const coverSize = Math.max(
    Math.round(width * 0.34),
    Math.min(maxWidth, available),
  );
  const coverTop = pad;

  if (data.image) {
    context.save();
    roundRect(context, pad, coverTop, coverSize, coverSize, Math.round(width * 0.03));
    context.clip();
    drawImageCover(context, data.image, pad, coverTop, coverSize, coverSize);
    context.restore();
  } else {
    paintCoverFallback(context, pad, coverTop, coverSize, theme, data.title);
  }

  /*
   * 歌词块的纵向位置。
   *
   * 原来是紧贴封面下方，剩下的高度全落到歌词和曲名之间 —— 9:16 上那块
   * 空白有 400 多像素，画面下半部空着一大片。把这段空余按 42/58 分给
   * 上下两侧，就是两段"留白"而不是一块"空地"。
   */
  const coverBottom = coverTop + coverSize;
  const slack = Math.max(0, textTop - coverBottom - lyricHeight - lyricGap);
  let y = coverBottom + lyricGap + Math.round(slack * 0.42) + lyricSize;
  if (wrapped.length) {
    const barTop = y - lyricSize;
    context.fillStyle = rgb(theme.accent, 0.85);
    context.fillRect(pad, barTop, Math.round(width * 0.006), lyricHeight);
    const textLeft = pad + Math.round(width * 0.032);
    context.font = font(600, lyricSize);
    context.textAlign = "left";
    context.fillStyle = theme.ink;
    for (const line of wrapped) {
      context.fillText(line, textLeft, y);
      y += lineHeight;
    }
  }

  paintText(context, title, pad, textTop + title.height, theme.ink);
  paintText(
    context,
    artist,
    pad,
    footBottom,
    rgb(theme.accent, 0.92),
  );
  paintFooter(context, frame, theme, data.footer);
}

/**
 * 拍立得：白边相纸。
 *
 * 和其他几个都是深底不同，这个是浅底 —— 分享到浅色背景的聊天窗口里
 * 不会像一块黑洞。所以它自己画底，不用 paintBackground 那层渐变。
 */
function paintPolaroidTemplate(context, frame, theme, data) {
  const { width, height } = frame;
  const margin = Math.round(width * 0.075);
  /*
   * 相纸按画布高度居中。
   *
   * 试过改成"按宽度定顶部"，结果 9:16 上相纸跑到顶、下方裂开 29% 的空白，
   * 比原来更糟。相纸是固定长宽比的实体，高画布上必然有余量 —— 让余量
   * 平均分在上下，比全部堆到一边好。上方 21% 是这个构图的代价，不是 bug。
   */
  const paperTop = Math.round(height * 0.5 - (width - margin * 2) * 0.62);
  const paperWidth = width - margin * 2;
  const border = Math.round(width * 0.042);
  const photo = paperWidth - border * 2;
  // 相纸高度 = 上下白边 + 照片 + 下方那截更宽的手写区
  const caption = Math.round(width * 0.2);
  const paperHeight = border * 2 + photo + caption;

  context.fillStyle = "rgb(238 235 228)";
  context.fillRect(0, 0, width, height);
  // 一层极淡的主色，避免整张纸死白
  context.fillStyle = rgb(theme.accent, 0.07);
  context.fillRect(0, 0, width, height);

  context.save();
  context.shadowColor = "rgb(20 18 14 / 0.28)";
  context.shadowBlur = Math.round(width * 0.05);
  context.shadowOffsetY = Math.round(width * 0.018);
  context.fillStyle = "rgb(253 252 249)";
  roundRect(context, margin, paperTop, paperWidth, paperHeight, Math.round(width * 0.012));
  context.fill();
  context.restore();

  const photoX = margin + border;
  const photoY = paperTop + border;
  if (data.image) {
    context.save();
    roundRect(context, photoX, photoY, photo, photo, Math.round(width * 0.006));
    context.clip();
    drawImageCover(context, data.image, photoX, photoY, photo, photo);
    context.restore();
  } else {
    paintCoverFallback(context, photoX, photoY, photo, theme, data.title);
  }

  // 手写区：一句歌词（只取第一句，相纸下沿放不下更多）+ 曲名歌手
  const ink = "rgb(38 34 28)";
  const captionTop = photoY + photo + Math.round(width * 0.055);
  const first = (data.lyrics || []).filter(Boolean)[0] || "";
  let y = captionTop;
  if (first) {
    const line = layoutText(context, first, {
      weight: 600,
      size: Math.round(width * 0.038),
      maxWidth: photo,
      maxLines: 1,
    });
    paintText(context, line, photoX, y + line.height, ink);
    y += line.height + Math.round(width * 0.028);
  }
  const title = layoutText(context, data.title, {
    weight: 700,
    size: Math.round(width * 0.034),
    maxWidth: photo,
    maxLines: 1,
  });
  paintText(context, title, photoX, y + title.height, ink);
  const artist = layoutText(context, data.artist || "未知歌手", {
    weight: 500,
    size: Math.round(width * 0.026),
    maxWidth: photo,
    maxLines: 1,
  });
  paintText(context, artist, photoX, y + title.height + Math.round(width * 0.038), "rgb(38 34 28 / 0.62)");

  // 底注这里要深色字，paintFooter 是给深底写的，所以自己画。
  context.font = font(500, Math.round(width * 0.022));
  context.textAlign = "center";
  context.fillStyle = "rgb(38 34 28 / 0.42)";
  context.fillText(data.footer || "", width / 2, height - Math.round(width * 0.05));
  context.textAlign = "left";
}

function fitLyricSize(context, lines, maxWidth, upper, lower) {
  for (let size = upper; size >= lower; size -= 2) {
    context.font = font(600, size);
    const allSingle = lines.every(
      (line) => context.measureText(line).width <= maxWidth,
    );
    if (allSingle) return size;
  }
  return lower;
}

function paintLyricTemplate(context, frame, theme, data) {
  const { width, height, pad } = frame;
  const maxWidth = width - pad * 2;
  const lines = (data.lyrics || []).filter(Boolean).slice(0, 6);

  // 上限按句数给：一句话的海报可以很大，六句就必须收着。
  const upper = Math.round(width * (lines.length <= 2 ? 0.085 : lines.length <= 4 ? 0.066 : 0.052));
  const lyricSize = lines.length
    ? fitLyricSize(context, lines, maxWidth, upper, Math.round(width * 0.036))
    : upper;
  context.font = font(600, lyricSize);
  const wrapped = lines.flatMap((line) =>
    wrapText(line, maxWidth, (text) => context.measureText(text).width, 2),
  );

  // 底部这一块（细线 + 曲名 + 歌手）先量出来，歌词才知道能占到哪。
  const titleBlock = layoutText(context, data.title, {
    weight: 700,
    size: Math.round(width * 0.04),
    maxWidth,
  });
  const artistBlock = layoutText(context, data.artist || "未知歌手", {
    weight: 500,
    size: Math.round(width * 0.028),
    maxWidth,
  });
  const footBlockTop =
    height - Math.round(pad * 1.6) - titleBlock.height - Math.round(width * 0.018) - artistBlock.height;

  const quoteSize = Math.round(width * 0.19);
  // 引号占位受画布高度约束：1:1 上 pad + 0.19*宽 已经是 27% 高，
  // 光这一下就把内容压到下半部。
  const quoteBottom = pad + Math.min(quoteSize, Math.round(height * 0.15));

  /*
   * 行距吃掉多余的高度，而不是让它变成空白。
   *
   * 这块前后调了三轮，记下结论免得再绕：
   *
   *   纯居中          → 画布越高上方越空（9:16 上 41% 下 8%，头重）
   *   起点靠上锚定    → 上方是好了，歌词和底部曲名之间裂开 46%
   *   起点掺一半余量  → 两个毛病各占一半
   *
   * 三种都在"把余量堆到某一侧"。四句歌词放进 1920px 高的画布，余量本来
   * 就有八百多像素，堆哪边都是一片空。真正的解法是让歌词块自己长高：
   * 余量摊进行距，字号不变（字号跟着长会挤掉可读性），行与行之间松开。
   *
   * 上限给 0.9 倍字号：再松就不像一首歌的连续几句，而像四条无关的标语。
   * 摊完还剩的余量才居中分到上下 —— 那时候剩得已经不多了。
   */
  const baseLineHeight = Math.round(lyricSize * 1.62);
  const gaps = Math.max(1, wrapped.length - 1);
  const roomForLyrics = footBlockTop - quoteBottom;
  const baseHeight = (wrapped.length - 1) * baseLineHeight + Math.round(lyricSize * 0.8);
  const spare = Math.max(0, roomForLyrics - baseHeight);
  const stretch = Math.min(Math.round(spare / gaps), Math.round(lyricSize * 0.9));
  const lineHeight = baseLineHeight + stretch;

  const blockHeight = (wrapped.length - 1) * lineHeight + Math.round(lyricSize * 0.8);
  const slack = Math.max(0, footBlockTop - quoteBottom - blockHeight);
  // 上方分到的余量给个上限：纯居中时画布越高上面越空，
  // 实测 9:16 首个内容在 36% 处。多出来的高度让它落到歌词和底部曲名
  // 之间 —— 那里有内容收尾，读起来是留白而不是空着。
  const top = Math.round(quoteBottom + Math.min(slack / 2, width * 0.05));

  // 起始的大引号，纯装饰。跟着歌词块走，不再用固定偏移。
  context.save();
  context.font = font(700, quoteSize);
  context.fillStyle = rgb(theme.accent, 0.16);
  context.textAlign = "left";
  context.fillText("“", pad - Math.round(width * 0.012), top);
  context.restore();

  context.save();
  context.textAlign = "left";
  context.font = font(600, lyricSize);
  context.fillStyle = theme.ink;
  let baseline = top + Math.round(lyricSize * 0.8);
  for (const line of wrapped) {
    context.fillText(line, pad, baseline);
    baseline += lineHeight;
  }
  context.restore();

  paintRule(context, pad, footBlockTop - Math.round(width * 0.03), Math.round(width * 0.09), theme);
  let y = paintText(context, titleBlock, pad, footBlockTop, theme.ink);
  paintText(context, artistBlock, pad, y + Math.round(width * 0.018), rgb(theme.accent, 0.9));

  paintFooter(context, frame, theme, data.footer);
}

/* --- 模板三：黑胶 --- */

function paintVinylTemplate(context, frame, theme, data) {
  const { width, height, pad } = frame;
  const radius = Math.round(width * 0.36);
  const cx = width / 2;
  const cy = Math.round(height * 0.36);

  // 唱片盘身
  context.save();
  context.shadowColor = "rgb(0 0 0 / 0.55)";
  context.shadowBlur = 70;
  context.shadowOffsetY = 26;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = "rgb(13 14 17)";
  context.fill();
  context.restore();

  // 纹路。间距故意不均匀，均匀同心圆看着像靶子。
  context.save();
  context.strokeStyle = "rgb(255 255 255 / 0.055)";
  for (let r = radius * 0.42; r < radius * 0.985; r += radius * 0.028) {
    context.lineWidth = r % 2 < 1 ? 1.4 : 0.8;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  // 盘面高光，让它看起来是有厚度的塑料而不是一个黑色圆。
  const sheen = context.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  sheen.addColorStop(0, "rgb(255 255 255 / 0.1)");
  sheen.addColorStop(0.42, "rgb(255 255 255 / 0)");
  sheen.addColorStop(0.62, "rgb(255 255 255 / 0.06)");
  sheen.addColorStop(1, "rgb(255 255 255 / 0)");
  context.save();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = sheen;
  context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  context.restore();

  // 中间标签就是封面
  const labelRadius = Math.round(radius * 0.38);
  context.save();
  context.beginPath();
  context.arc(cx, cy, labelRadius, 0, Math.PI * 2);
  context.clip();
  if (data.image) {
    drawImageCover(context, data.image, cx - labelRadius, cy - labelRadius, labelRadius * 2, labelRadius * 2);
  } else {
    paintCoverFallback(context, cx - labelRadius, cy - labelRadius, labelRadius * 2, theme, data.title);
  }
  context.restore();

  // 中心孔
  context.beginPath();
  context.arc(cx, cy, Math.round(radius * 0.035), 0, Math.PI * 2);
  context.fillStyle = "rgb(10 11 14)";
  context.fill();

  /*
   * 唱臂。
   *
   * 之前只画了一条线加一个点，读起来像一道划痕而不是唱臂 ——
   * 因为缺了支点：真唱臂一端固定在转盘右上角的轴上。
   * 现在补三段：轴座（圆盘）、臂杆（两层，外深内浅，做出圆柱感）、
   * 针头（主色小块）。
   */
  const pivotX = width - pad * 0.6;
  const pivotY = cy - radius * 1.04;
  const tipX = cx + radius * 0.52;
  const tipY = cy - radius * 0.2;

  context.save();
  // 轴座
  context.fillStyle = "rgb(26 27 32)";
  context.beginPath();
  context.arc(pivotX, pivotY, Math.max(14, width * 0.028), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgb(255 255 255 / 0.16)";
  context.beginPath();
  context.arc(pivotX, pivotY, Math.max(6, width * 0.012), 0, Math.PI * 2);
  context.fill();

  // 臂杆：先粗后细画两遍，外圈当暗边、内圈当高光。
  context.lineCap = "round";
  context.strokeStyle = "rgb(18 19 23)";
  context.lineWidth = Math.max(9, width * 0.015);
  context.beginPath();
  context.moveTo(pivotX, pivotY);
  context.lineTo(tipX, tipY);
  context.stroke();
  context.strokeStyle = "rgb(255 255 255 / 0.3)";
  context.lineWidth = Math.max(3, width * 0.005);
  context.beginPath();
  context.moveTo(pivotX, pivotY);
  context.lineTo(tipX, tipY);
  context.stroke();

  // 针头
  context.fillStyle = rgb(theme.accent, 0.95);
  context.beginPath();
  context.arc(tipX, tipY, Math.max(7, width * 0.013), 0, Math.PI * 2);
  context.fill();
  context.restore();

  const maxWidth = width - pad * 2;
  const title = layoutText(context, data.title, {
    weight: 700,
    size: Math.round(width * 0.066),
    maxWidth,
    maxLines: 2,
  });
  const artist = layoutText(context, data.artist || "未知歌手", {
    weight: 500,
    size: Math.round(width * 0.033),
    maxWidth,
  });
  const album = data.album
    ? layoutText(context, data.album, {
        weight: 400,
        size: Math.round(width * 0.026),
        maxWidth,
      })
    : null;

  /*
   * 先给底注留出位置，再决定这一叠文字画到哪、专辑行画不画。
   *
   * 原来是从唱片下沿往下顺着排，不看还剩多少 —— 1:1 上唱片直径就占了
   * 0.72 个画布宽，排到专辑行时已经压到底注上，「女生宿舍」和
   * 「SongLib Amp · 音屿」直接叠在一起。方版竖向空间本来就不够，
   * 放不下就不画专辑，而不是画上去撞车。
   */
  const footerReserve = Math.round(width * 0.05) + Math.round(width * 0.032);
  const limit = height - footerReserve;
  const gapArtist = Math.round(width * 0.028);
  const gapAlbum = Math.round(width * 0.02);

  let y = cy + radius + Math.round(height * 0.06);
  const need = title.height + gapArtist + artist.height;
  // 唱片下沿加这一叠超过底注上界时，整叠往上提，不让它压过去。
  if (y + need > limit) y = Math.max(cy + radius + pad, limit - need);

  y = paintText(context, title, cx, y, theme.ink, "center");
  y = paintText(context, artist, cx, y + gapArtist, rgb(theme.accent, 0.95), "center");
  if (album && y + gapAlbum + album.height <= limit) {
    paintText(context, album, cx, y + gapAlbum, "rgb(255 255 255 / 0.42)", "center");
  }

  paintFooter(context, frame, theme, data.footer);
}

/* --- 模板四：极简 --- */

/**
 * 极简。
 *
 * 之前这个模板有两处硬伤，都是"用画布高度的百分比当间距"造成的：
 *   - NOW PLAYING 和曲名叠在一起。间距给了 0.055×1440 = 79px，
 *     而曲名字号是 0.09×1080 = 97px，上伸部分直接盖回去。
 *   - 内容全挤在上面三分之一，下面 60% 空着。
 *
 * 现在改成：每一块先量高度，间距按**字号**推，整摞算完总高再垂直居中。
 */
function paintMinimalTemplate(context, frame, theme, data) {
  const { width, height, pad } = frame;
  const maxWidth = width - pad * 2;

  const eyebrow = layoutText(context, "NOW PLAYING", {
    weight: 700,
    size: Math.round(width * 0.026),
    maxWidth,
  });
  const title = layoutText(context, data.title || "未命名", {
    weight: 700,
    size: Math.round(width * 0.09),
    maxWidth,
    maxLines: 3,
    leading: 1.14,
  });
  const meta = layoutText(
    context,
    [data.artist || "未知歌手", data.album].filter(Boolean).join(" · "),
    { weight: 400, size: Math.round(width * 0.038), maxWidth },
  );
  const first = (data.lyrics || []).filter(Boolean)[0];
  const lyric = first
    ? layoutText(context, first, {
        weight: 500,
        size: Math.round(width * 0.034),
        maxWidth,
        maxLines: 2,
        leading: 1.5,
      })
    : null;

  // 间距都从相邻块的字号推出来，不用画布高度的百分比。
  const gapEyebrow = Math.round(title.size * 0.34);
  const gapMeta = Math.round(meta.size * 0.78);
  const gapLyric = lyric ? Math.round(lyric.size * 1.5) : 0;

  const stackHeight =
    eyebrow.height +
    gapEyebrow +
    title.height +
    gapMeta +
    meta.height +
    (lyric ? gapLyric + lyric.height : 0);

  // 略偏上：底注占了下方，视觉重心放在偏上一点更稳。
  // 试过改成靠上锚定，结果空白全跑到下面去（9:16 下方空 67%），更糟。
  // 字少画布高的时候留白就是大的，关键是上下配平，不是消灭留白。
  /*
   * 纵向锚点：居中，但距顶有上限。
   *
   * 纯居中时字块本来就矮，画布一高上面就空一大片 —— 实测 9:16 首个
   * 内容在 39% 处、3:4 在 37% 处，下面到 96% 才收尾，等于全挤在下半部。
   * 上限按宽度给，所以不管什么比例，顶部留白都是同一个视觉量。
   */
  /*
   * 纵向锚点：上方留白约占可用高度的三分之一。
   *
   * 试过两个极端，都不行：
   *   纯居中        画布一高，字块沉到中部，上面空 39%（实测 9:16）
   *   距顶固定比例  9:16 上全挤进上方 30%，下面空 66%
   *
   * 现在按比例分：可用高度减去字块，剩下的三分之一放上面、三分之二
   * 放下面。这是版面里常见的"上三分之一"重心 —— 不管画布多高多矮，
   * 上下的比例是恒定的，不会某个比例下突然贴顶或者沉底。
   */
  const available = height - pad * 2 - Math.round(width * 0.06);
  const y0 = pad + Math.max(0, Math.round((available - stackHeight) / 3));
  let y = y0;

  y = paintText(context, eyebrow, pad, y, rgb(theme.accent, 0.9));
  y = paintText(context, title, pad, y + gapEyebrow, theme.ink);
  y = paintText(context, meta, pad, y + gapMeta, "rgb(255 255 255 / 0.56)");
  if (lyric) {
    const lyricTop = y + gapLyric;
    paintRule(context, pad, lyricTop - Math.round(gapLyric * 0.45), Math.round(width * 0.1), theme);
    paintText(context, lyric, pad, lyricTop, "rgb(255 255 255 / 0.76)");
  }

  paintFooter(context, frame, theme, data.footer);
}

/* =================================================================
 * 加载与导出
 * ================================================================= */

/**
 * 载入封面。
 *
 * crossOrigin = "anonymous" 是必须的：不设的话图能显示，但画进 canvas
 * 之后画布被污染，toBlob 直接抛 SecurityError —— 预览正常、导出失败，
 * 是最难查的一种。设了之后跨域图会加载失败，那就当没封面处理，
 * 比导不出来好。
 */
export function loadCover(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "sync";
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** 文件名。去掉路径分隔符和 Windows 不允许的字符。 */
export function posterFileName(title, artist) {
  const base = [artist, title].filter(Boolean).join(" - ") || "songlib-poster";
  return `${base.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.png`;
}
