export const parseLrc = (text) =>
  (text || "")
    .replace(/\\n/g, "\n")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?]\s*(.*)$/);
      if (!match) return [];
      return [
        {
          time:
            Number(match[1]) * 60 +
            Number(match[2]) +
            Number(`0.${match[3] || 0}`),
          text: match[4] || "♪",
        },
      ];
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
