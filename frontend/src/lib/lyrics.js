const timestampSeconds = (minutes, seconds, fraction = "") =>
  Number(minutes) * 60 +
  Number(seconds) +
  (fraction ? Number(String(fraction).padEnd(3, "0")) / 1000 : 0);

export const parseLrc = (text) =>
  (text || "")
    .replace(/\\n/g, "\n")
    .split(/\r?\n/)
    .flatMap((line) => {
      const lineTimes = [
        ...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]/g),
      ];
      if (!lineTimes.length) return [];

      const lastLineTime = lineTimes[lineTimes.length - 1];
      const body = line.slice(lastLineTime.index + lastLineTime[0].length);
      const wordTimes = [
        ...body.matchAll(/<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g),
      ];
      const words = wordTimes.flatMap((mark, index) => {
        const next = wordTimes[index + 1];
        const prefix = index === 0 ? body.slice(0, mark.index) : "";
        const value =
          prefix + body.slice(mark.index + mark[0].length, next?.index ?? body.length);
        return value
          ? [{ time: timestampSeconds(mark[1], mark[2], mark[3]), text: value }]
          : [];
      });
      const visible =
        (words.length ? words.map((word) => word.text).join("") : body).trim() ||
        "♪";

      return lineTimes.map((mark) => ({
        time: timestampSeconds(mark[1], mark[2], mark[3]),
        text: visible,
        words,
      }));
    })
    .sort((a, b) => a.time - b.time);

export const displayLyricsFor = (track, parsed = parseLrc(track?.lyrics)) => {
  if (parsed.length) return parsed;
  const plain = (track?.lyrics || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (plain.length)
    return plain.map((text, index) => ({ time: index * 7, text }));
  return [];
};

/**
 * 这一行是不是版权/制作信息，而不是歌词。
 *
 * LRC 开头常带一整段「词：」「曲：」「编曲：」「OP：」「SP：」，还有
 * 一行「歌名 - 歌手」。它们跟歌词混在一条列表里，如果和歌词同一个字号，
 * 整块看起来就是在喊 —— 实际截图里前八行全是这种，占满了半屏。
 *
 * 只做标记不做删除：有人确实想看制作人是谁。展示层把它们降级成小字，
 * 海报那边则直接跳过（海报上放「OP：蜂鸟音乐」没有意义）。
 *
 * 简写和全称都要认：既有「作词」也有「词」，冒号可能是中文也可能是英文。
 */
const CREDIT_PREFIX =
  /^(作词|作曲|编曲|改编词|填词|词|曲|制作|制作人|混音|母带|监制|出品|录音|发行|演唱|和声|吉他|贝斯|鼓|键盘|弦乐|OP|SP|Lyrics?|Composer|Arranger|Producer|Mixing|Mastering)\s*[：:]/i;

export const isCreditLine = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (CREDIT_PREFIX.test(text)) return true;
  /*
   * 「歌名 - 歌手」那种整首歌的抬头行。
   *
   * 排除的是中文标点：有标点的一行几乎一定是歌词，
   * 「你走 - 我不留，我不留」不会被误判。
   * 但不能排除 ASCII 句点 —— 歌手名里就有（G.E.M.），
   * 第一版排了，结果「红蔷薇白玫瑰 - G.E.M. 邓紫棋」没认出来。
   */
  return /^[^，。！？；、]{1,30}\s[-—–]\s[^，。！？；、]{1,30}$/.test(text);
};
