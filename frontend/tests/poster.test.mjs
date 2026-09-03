/**
 * 分享海报。
 *
 * 绘制部分没法在 Node 里真的画出来，但可以做一件更有用的事：
 * 用一个假的 2D context 记录所有调用，任何坐标或尺寸只要是
 * NaN / Infinity 就立刻失败。
 *
 * 为什么专门查这个：canvas 遇到 NaN 坐标**不报错**，它安静地什么都不画。
 * 一个字号算错就会让整块文字消失，而构建、类型、eslint 全都发现不了 ——
 * 只能靠盯着看。这个测试把"盯着看"变成断言。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isCreditLine } from "../src/lib/lyrics.js";

import {
  RATIOS,
  TEMPLATES,
  posterFileName,
  shareableLyricLines,
  wrapText,
} from "../src/lib/poster.js";

/* =================================================================
 * 折行
 * ================================================================= */

// 等宽假字体：中日韩算 2 个单位，其他算 1 个。够用来验折行逻辑。
const measure = (text) =>
  [...String(text)].reduce(
    (sum, char) => sum + (/[　-鿿＀-￯]/.test(char) ? 2 : 1),
    0,
  );

test("折行按字符试宽，中文没有空格也能折", () => {
  const lines = wrapText("我们在夜里唱着不会结束的歌", 10, measure);
  assert.ok(lines.length > 1, "13 个汉字（26 单位）放不进 10 单位，必须折行");
  for (const line of lines) {
    assert.ok(measure(line) <= 10, `"${line}" 宽 ${measure(line)}，超了`);
  }
  assert.equal(lines.join(""), "我们在夜里唱着不会结束的歌", "折行不能丢字");
});

test("拉丁单词不从中间劈开", () => {
  const lines = wrapText("Bohemian Rhapsody forever", 12, measure);
  for (const line of lines) {
    for (const word of line.split(" ")) {
      // 每个词要么完整出现在原文里，要么是被省略号截断的最后一个。
      if (word.endsWith("…")) continue;
      assert.ok(
        "Bohemian Rhapsody forever".includes(word),
        `"${word}" 不是原文里的完整单词`,
      );
    }
  }
});

test("超过行数上限时截断，并且截断后仍然不超宽", () => {
  const lines = wrapText("一二三四五六七八九十一二三四五六七八九十", 8, measure, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"), "最后一行要有省略号");
  for (const line of lines) {
    assert.ok(
      measure(line) <= 8,
      `"${line}" 宽 ${measure(line)} —— 加省略号之后不能反而超宽`,
    );
  }
});

test("空文本折出空数组，不是一个空字符串", () => {
  assert.deepEqual(wrapText("", 10, measure), []);
  assert.deepEqual(wrapText("   ", 10, measure), []);
  assert.deepEqual(wrapText(null, 10, measure), []);
});

/* =================================================================
 * 歌词筛选
 * ================================================================= */

test("能上海报的歌词：去掉元信息、占位符、重复和过长行", () => {
  const picked = shareableLyricLines([
    { time: 0, text: "作词：林夕" },
    { time: 1, text: "编曲 : 某人" },
    { time: 2, text: "♪" },
    { time: 3, text: "" },
    { time: 4, text: "海阔天空" },
    { time: 5, text: "海阔天空" },
    { time: 6, text: "今天我" },
    // 50 个字。上限是 34 —— 写这条断言时第一版只写了 33 个字，
    // 于是测试失败，但错的是测试不是代码。
    { time: 7, text: "这一行故意写得非常非常非常长长长长长长长长长长长长长长长长长长长长长长长超过三十四个字所以不该被选上" },
  ]);
  assert.deepEqual(
    picked.map((line) => line.text),
    ["海阔天空", "今天我"],
  );
});

test("重复副歌只留第一次出现的位置", () => {
  const picked = shareableLyricLines([
    { time: 10, text: "原谅我这一生不羁放纵爱自由" },
    { time: 40, text: "原谅我这一生不羁放纵爱自由" },
    { time: 70, text: "原谅我这一生不羁放纵爱自由" },
  ]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].time, 10, "留最早那次，时间戳要能对回歌词行");
});

/* =================================================================
 * 文件名
 * ================================================================= */

test("文件名去掉路径分隔符和 Windows 不允许的字符", () => {
  const name = posterFileName('AC/DC: "Live"?', "Back\\Slash");
  assert.ok(!/[\\/:*?"<>|]/.test(name), `${name} 里还有非法字符`);
  assert.ok(name.endsWith(".png"));
});

test("标题歌手都空时也给得出一个可用的文件名", () => {
  assert.equal(posterFileName("", ""), "songlib-poster.png");
});

/* =================================================================
 * 绘制：不许出现 NaN
 * ================================================================= */

/** 记录所有调用，任何非有限数字直接抛。 */
function stubContext(calls) {
  const guard = (name, args) => {
    for (const [index, value] of args.entries()) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`${name} 的第 ${index + 1} 个参数是 ${value}`);
      }
    }
    calls.push({ name, args });
  };
  const gradient = { addColorStop: (...args) => guard("addColorStop", args) };
  const context = {
    canvas: null,
    filter: "none",
    createLinearGradient: (...args) => (guard("createLinearGradient", args), gradient),
    createRadialGradient: (...args) => (guard("createRadialGradient", args), gradient),
    measureText: (text) => ({ width: measure(text) * 8 }),
  };
  const voidMethods = [
    "setTransform", "save", "restore", "fillRect", "beginPath", "moveTo",
    "lineTo", "arcTo", "arc", "closePath", "fill", "stroke", "clip",
    "fillText", "drawImage",
  ];
  for (const name of voidMethods) context[name] = (...args) => guard(name, args);
  // 这些是赋值属性，不是方法 —— 用 setter 拦一下数值型的。
  for (const name of ["lineWidth", "globalAlpha", "shadowBlur", "shadowOffsetY"]) {
    let stored = 0;
    Object.defineProperty(context, name, {
      get: () => stored,
      set: (value) => {
        if (!Number.isFinite(value)) throw new Error(`${name} 被设成 ${value}`);
        stored = value;
      },
    });
  }
  return context;
}

/** 假的 canvas + 假的封面图。drawPoster 只用到这几个字段。 */
function stubCanvas(calls) {
  const context = stubContext(calls);
  return {
    width: 0,
    height: 0,
    getContext: () => context,
  };
}

const FAKE_IMAGE = { naturalWidth: 600, naturalHeight: 600 };

test("四个模板、三个比例、有无封面有无歌词，都不产生 NaN 坐标", async (t) => {
  // drawPoster 里 paletteFromImage 会用 document，测试里直接传死 palette 绕开。
  const { drawPoster } = await import("../src/lib/poster.js");
  const palette = { accent: [227, 180, 89], ink: "#f5f2ec", dark: true };

  for (const template of Object.keys(TEMPLATES)) {
    for (const ratio of Object.keys(RATIOS)) {
      for (const image of [FAKE_IMAGE, null]) {
        for (const lyrics of [[], ["一句歌词"], ["第一句", "第二句", "第三句", "第四句", "第五句", "第六句"]]) {
          const calls = [];
          const canvas = stubCanvas(calls);
          const label = `${template}/${ratio}/${image ? "有封面" : "无封面"}/${lyrics.length}句`;
          await t.test(label, () => {
            drawPoster(canvas, {
              template,
              ratio,
              title: "海阔天空",
              artist: "Beyond",
              album: "乐与怒",
              lyrics,
              image,
              palette,
              footer: "SongLib Amp · 音屿",
              scale: 1,
            });
            assert.ok(calls.length > 20, "画得太少，多半是提前返回了");
            assert.ok(
              calls.some((call) => call.name === "fillText"),
              "一张海报至少要有文字",
            );
          });
        }
      }
    }
  }
});

/**
 * 文字不许重叠、不许画到画布外面。
 *
 * 加这条的直接原因：真去量了一遍每行文字的落点，发现
 *   - 1:1「专辑」：曲名/歌手/专辑整块画在 1042–1234，而画布只有 1080 高，
 *     方版海报上这三行**完全看不见**；
 *   - 1:1「拍立得」：相纸自身就比画布高 54px，手写区被挤出去；
 *   - 「封面歌词」「拍立得」把块高加进了顶部坐标，整块低一个自身高度，
 *     曲名和歌手之间设计好的间距被吃光还叠了 1px；
 *   - 1:1 四句歌词时最后一行压在曲名上。
 *
 * 上面这些，NaN 检查全过、只数空白带的留白检查也全过 —— 因为它们既不是
 * NaN，也不改变空白比例。只有"把每个字的盒子摆出来看有没有撞上"才发现得了。
 */
test("每个模板 × 比例 × 句数：文字不重叠、不出画布", async (t) => {
  const { drawPoster } = await import("../src/lib/poster.js");
  const palette = { accent: [227, 180, 89], ink: "#f5f2ec", dark: true };

  /** 记录每次 fillText 的纵向占位。ascent 0.8 / descent 0.24 跟 layoutText 一致。 */
  function boxRecordingContext(boxes) {
    let size = 16;
    const gradient = { addColorStop: () => {} };
    const context = {
      canvas: null,
      filter: "none",
      textAlign: "left",
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      measureText: (text) => ({ width: measure(text) * 8 }),
      fillText: (text, x, y) => {
        if (String(text).trim())
          boxes.push({ text: String(text), top: y - size * 0.8, bottom: y + size * 0.24 });
      },
    };
    Object.defineProperty(context, "font", {
      get: () => `${size}px x`,
      set: (value) => {
        const found = /(\d+(?:\.\d+)?)px/.exec(value);
        if (found) size = Number(found[1]);
      },
    });
    for (const name of [
      "setTransform", "save", "restore", "fillRect", "beginPath", "moveTo",
      "lineTo", "arcTo", "arc", "closePath", "fill", "stroke", "clip", "drawImage",
    ]) context[name] = () => {};
    for (const name of ["lineWidth", "globalAlpha", "shadowBlur", "shadowOffsetY"]) {
      let stored = 0;
      Object.defineProperty(context, name, { get: () => stored, set: (v) => { stored = v; } });
    }
    return context;
  }

  const LYRIC_SETS = [
    [],
    ["原谅我这一生不羁放纵爱自由"],
    ["原谅我这一生不羁放纵爱自由", "也会怕有一天会跌倒", "背弃了理想谁人都可以", "哪会怕有一天只你共我"],
  ];

  for (const template of Object.keys(TEMPLATES)) {
    for (const ratio of Object.keys(RATIOS)) {
      for (const lyrics of LYRIC_SETS) {
        const label = `${template}/${ratio}/${lyrics.length}句`;
        await t.test(label, () => {
          const boxes = [];
          const context = boxRecordingContext(boxes);
          const canvas = { width: 0, height: 0, getContext: () => context };
          drawPoster(canvas, {
            template, ratio, title: "海阔天空", artist: "Beyond", album: "乐与怒",
            lyrics, image: FAKE_IMAGE, palette, footer: "SongLib Amp · 音屿", scale: 1,
          });
          for (const box of boxes) {
            assert.ok(
              box.top >= 0 && box.bottom <= canvas.height,
              `"${box.text.slice(0, 14)}" 画到了画布外：${box.top.toFixed(0)}–${box.bottom.toFixed(0)}，画布高 ${canvas.height}`,
            );
          }
          // 大引号是刻意衬在歌词背后的装饰（见 paintLyricTemplate 里的注释），不参与。
          const stacked = boxes
            .filter((box) => !/^[“”"']+$/.test(box.text.trim()))
            .sort((a, b) => a.top - b.top);
          for (let i = 1; i < stacked.length; i += 1) {
            const above = stacked[i - 1];
            const below = stacked[i];
            assert.ok(
              below.top >= above.bottom - 0.5,
              `"${above.text.slice(0, 12)}" 和 "${below.text.slice(0, 12)}" 叠了 ${(above.bottom - below.top).toFixed(0)}px`,
            );
          }
        });
      }
    }
  }
});

test("标题歌手全空也能画出来，不能因为没内容就崩", async () => {
  const { drawPoster } = await import("../src/lib/poster.js");
  const calls = [];
  drawPoster(stubCanvas(calls), {
    template: "cover",
    ratio: "3:4",
    title: "",
    artist: "",
    album: "",
    lyrics: [],
    image: null,
    palette: { accent: [227, 180, 89], ink: "#fff", dark: true },
    scale: 1,
  });
  assert.ok(calls.length > 10);
});

test("导出倍数直接乘到位图尺寸上", async () => {
  const { drawPoster } = await import("../src/lib/poster.js");
  const canvas = stubCanvas([]);
  drawPoster(canvas, {
    template: "minimal",
    ratio: "1:1",
    title: "x",
    palette: { accent: [1, 2, 3], ink: "#fff", dark: true },
    scale: 2,
  });
  assert.equal(canvas.width, RATIOS["1:1"].width * 2);
  assert.equal(canvas.height, RATIOS["1:1"].height * 2);
});

test("版权行不进歌词：简写「词：」「曲：」和「歌名 - 歌手」抬头都要认出来", () => {
  const lines = [
    { time: 0, text: "红蔷薇白玫瑰 - G.E.M. 邓紫棋" },
    { time: 1, text: "词：TE DI/DEE.P/Johnson Rebecca Rose" },
    { time: 2, text: "曲：TE DI/SOL" },
    { time: 3, text: "编曲：Lupo" },
    { time: 4, text: "改编词：G.E.M. 邓紫棋" },
    { time: 5, text: "OP：蜂鸟音乐" },
    { time: 6, text: "SP：百纳娱乐" },
    { time: 7, text: "说不出说不出一句话" },
    { time: 8, text: "面对最熟悉的你" },
    // 歌词里带连字符不能被当成抬头行
    { time: 9, text: "你走 - 我不留，我不留" },
  ];
  const kept = shareableLyricLines(lines).map((line) => line.text);
  assert.deepEqual(kept, ["说不出说不出一句话", "面对最熟悉的你", "你走 - 我不留，我不留"]);
});

test("歌手名里的点不能让抬头行漏判", () => {
  // 第一版把 ASCII 句点也排除了，于是 G.E.M. 那行没认出来。
  assert.equal(isCreditLine("红蔷薇白玫瑰 - G.E.M. 邓紫棋"), true);
  assert.equal(isCreditLine("此刻我忐忑的心"), false);
});
