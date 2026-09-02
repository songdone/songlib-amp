/**
 * 平台代码 → 中文名。
 *
 * 后端和音源脚本之间传的是 kw / kg / tx / wy / mg 这类两字母代码。
 * 这些代码不该出现在界面上 —— 用户没有理由知道 tx 是 QQ 音乐。
 * 认不出来的代码原样返回，好过显示"未知"把信息抹掉。
 */
export const PLATFORM_LABELS = Object.freeze({
  tx: "QQ 音乐",
  wy: "网易云",
  kg: "酷狗",
  kw: "酷我",
  mg: "咪咕",
  local: "本地文件",
});

export const platformLabel = (code) =>
  PLATFORM_LABELS[String(code || "").toLowerCase()] || code || "";

/** 音源是怎么导进来的。sourceType 存的是 url / file / code。 */
export const SOURCE_TYPE_LABELS = Object.freeze({
  url: "在线地址",
  file: "本地文件",
  code: "粘贴的源码",
});

export const sourceTypeLabel = (value) =>
  SOURCE_TYPE_LABELS[String(value || "").toLowerCase()] || value || "";

export const sourceCatalogReady = (source) => {
  if (!source?.enabled) return false;
  if (source.catalogReady || source.accessGranted || source.searchOk) return true;
  const inspection = source.inspectResult || {};
  return Boolean(inspection.ok);
};

export const mergeCatalogResults = (items = []) =>
  [...new Map(
    items.map((item) => [
      `${item.platform || "unknown"}:${item.trackId || item.id || ""}`,
      item,
    ]),
  ).values()];
