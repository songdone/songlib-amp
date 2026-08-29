export const mobileNavigationIds = [
  "home",
  "library",
  "player",
  "playlists",
  "manage",
  "settings",
];

export const mobileNavigationTarget = (active, managementIds = []) => {
  if (active === "settings") return "settings";
  if (
    active === "manage" ||
    managementIds.includes(active)
  ) {
    return "manage";
  }
  if (active === "discover") return "home";
  if (active === "me" || active === "search") return "library";
  return active;
};
