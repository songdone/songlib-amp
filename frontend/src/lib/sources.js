export const sourceCatalogReady = (source) => {
  if (!source?.enabled) return false;
  if (source.catalogReady || source.searchOk) return true;
  const inspection = source.inspectResult || {};
  return Boolean(
    inspection.ok &&
      (inspection.catalog_search_adapter || inspection.methods?.search),
  );
};
