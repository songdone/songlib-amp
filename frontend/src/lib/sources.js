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
