const shuffle = (items, random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

export const buildAmbientDeck = (items, random = Math.random) => {
  const seen = new Set();
  const unique = (Array.isArray(items) ? items : [])
    .filter((item) => {
      const imageUrl = String(item?.imageUrl || "").trim();
      if (!imageUrl || seen.has(imageUrl)) return false;
      seen.add(imageUrl);
      return true;
    })
    .sort(
      (left, right) =>
        Number(right.trackCount || 0) - Number(left.trackCount || 0),
    );
  if (unique.length < 2) return unique;
  const prioritySize = Math.min(
    unique.length,
    Math.max(8, Math.ceil(unique.length * 0.35)),
  );
  return [
    ...shuffle(unique.slice(0, prioritySize), random),
    ...shuffle(unique.slice(prioritySize), random),
  ];
};
