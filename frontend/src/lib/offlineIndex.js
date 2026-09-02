/**
 * 离线可用的曲库索引。
 *
 * NAS 断连的时候，至少还能翻自己的曲库、搜到某首歌在哪张专辑里。
 * 现在断连就是一片空白 —— Service Worker 对 /api/ 是直接放行的，
 * 什么都没缓。
 *
 * 为什么不靠 Service Worker 缓存响应：
 * 缓下来的是 `/api/library/albums?pageSize=24` 这样一个个具体响应，
 * 它能让你再看一遍刚看过的那一页，但**搜不了**。
 * 离线时真正需要的是"我那首歌叫什么、在哪儿"，那需要一份可检索的索引，
 * 不是一堆分页响应。
 *
 * 所以这里维护一份精简索引：每条只留检索和展示要用的字段，
 * 加上一份能重新起播的最小 payload。1439 首歌大约 300KB，
 * IndexedDB 装得下，读一次几十毫秒。
 *
 * 检索和排序是纯函数（normalizeQuery / scoreEntry / rankEntries），
 * 单独测；IndexedDB 那层只做存取。
 */

const DB_NAME = "songlib-offline";
const DB_VERSION = 1;
const STORE = "catalog";
const META = "meta";

/* =================================================================
 * 纯逻辑
 * ================================================================= */

/**
 * 归一化检索词。
 *
 * 去掉空白和标点、转小写。中文没有大小写，但曲名里常混着
 * 全角括号、书名号和空格 ——「海阔天空（Live）」和「海阔天空 live」
 * 应该能互相搜到。
 */
export function normalizeQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[（）()【】\[\]《》「」“”'"’·、,，.。\-_/\\]/g, "");
}

/**
 * 一条索引项对一个检索词的得分。0 表示不匹配。
 *
 * 分档而不是布尔：离线搜索没有服务端的相关度排序，
 * 全靠这里区分"标题就叫这个"和"专辑名里碰巧含这两个字"。
 */
export function scoreEntry(entry, needle) {
  if (!needle) return 0;
  const title = entry.searchTitle || "";
  const subtitle = entry.searchSubtitle || "";
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;
  if (subtitle.startsWith(needle)) return 40;
  if (subtitle.includes(needle)) return 20;
  return 0;
}

/** 按得分排序；同分时按标题长度（短的更可能是用户要找的那个）。 */
export function rankEntries(entries, query, limit = 40) {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.entry.title?.length || 0) - (b.entry.title?.length || 0),
    )
    .slice(0, limit)
    .map((item) => item.entry);
}

/**
 * 把一条 API 返回的条目压成索引项。
 *
 * 只留检索、展示、重新起播这三件事需要的字段。整条塞进去会让
 * 1439 首歌变成几兆 —— 里面大部分是 audioUrl、transcodeUrls 这类
 * 一离线就作废的东西。
 */
export function toEntry(kind, item) {
  const title =
    item.title || item.name || item.filename || item.parentTitle || "";
  const subtitle =
    kind === "track"
      ? [item.artist || item.grandparentTitle, item.album || item.parentTitle]
          .filter(Boolean)
          .join(" · ")
      : kind === "album"
        ? item.parentTitle || item.artist || ""
        : kind === "artist"
          ? "歌手"
          : item.artist || "";
  const key = `${kind}:${item.id || item.ratingKey || item.path || title}`;
  return {
    key,
    kind,
    title,
    subtitle,
    coverUrl: item.thumbUrl || item.coverUrl || item.albumCoverUrl || "",
    searchTitle: normalizeQuery(title),
    searchSubtitle: normalizeQuery(subtitle),
    payload: {
      id: item.id,
      ratingKey: item.ratingKey,
      path: item.path,
      sourceType: item.sourceType,
      duration: item.duration,
    },
  };
}

/* =================================================================
 * IndexedDB
 * ================================================================= */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // 隐私模式或者被策略禁掉时 indexedDB 可能不存在。
    if (typeof indexedDB === "undefined") {
      reject(new Error("这个浏览器不允许本地存储"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    // 失败之后把 promise 清掉，下次还能再试一遍。
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

const runTx = (storeName, mode, work) =>
  openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = work(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );

/**
 * 记下一批条目。
 *
 * 用 put 而不是先清后写：几个来源（歌手 / 专辑 / 单曲 / 本地文件）
 * 各自在不同时刻到达，清空会让后到的那批把前面的抹掉。
 * key 带 kind 前缀，所以不同来源之间不会互相覆盖。
 */
export async function remember(kind, items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const entries = items.map((item) => toEntry(kind, item)).filter((e) => e.title);
  if (!entries.length) return 0;
  try {
    await runTx(STORE, "readwrite", (store) => {
      for (const entry of entries) store.put(entry);
    });
    await runTx(META, "readwrite", (store) => {
      store.put({ id: "state", updatedAt: new Date().toISOString() });
    });
    return entries.length;
  } catch {
    // 索引存不下不影响在线使用，不打扰用户。
    return 0;
  }
}

async function allEntries() {
  try {
    return await runTx(STORE, "readonly", (store) => {
      const request = store.getAll();
      const box = [];
      request.onsuccess = () => box.push(...(request.result || []));
      return box;
    });
  } catch {
    return [];
  }
}

/** 离线检索。返回 [] 表示索引是空的或读不出来。 */
export async function searchOffline(query, limit = 40) {
  const entries = await allEntries();
  return rankEntries(entries, query, limit);
}

/** 索引状态，用来在界面上说明"这是 X 之前存下的"。 */
export async function indexStatus() {
  try {
    const [count, meta] = await Promise.all([
      runTx(STORE, "readonly", (store) => {
        const request = store.count();
        const box = { value: 0 };
        request.onsuccess = () => {
          box.value = request.result || 0;
        };
        return box;
      }),
      runTx(META, "readonly", (store) => {
        const request = store.get("state");
        const box = { value: null };
        request.onsuccess = () => {
          box.value = request.result || null;
        };
        return box;
      }),
    ]);
    return { count: count.value, updatedAt: meta.value?.updatedAt || null };
  } catch {
    return { count: 0, updatedAt: null };
  }
}
