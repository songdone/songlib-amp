const CACHE_PREFIX = "songlib-fast:";

export const readFastCache = (key, fallback, storage = globalThis.sessionStorage) => {
  try {
    const parsed = JSON.parse(storage?.getItem(`${CACHE_PREFIX}${key}`) || "");
    return parsed && Object.prototype.hasOwnProperty.call(parsed, "value")
      ? parsed.value
      : fallback;
  } catch {
    return fallback;
  }
};

export const writeFastCache = (key, value, storage = globalThis.sessionStorage) => {
  try {
    storage?.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ value, updatedAt: Date.now() }),
    );
  } catch {
    // Storage may be unavailable in private browsing or when a quota is full.
  }
  return value;
};

export const clearFastCache = (storage = globalThis.sessionStorage) => {
  try {
    const keys = typeof storage?.keys === "function"
      ? Array.from(storage.keys())
      : Array.from({ length: storage?.length || 0 }, (_, index) => storage.key(index));
    keys
      .filter(Boolean)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => storage.removeItem(key));
  } catch {
    // Logging out still succeeds if browser storage is unavailable.
  }
};
