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
