export const mobileNavigationIds = [
  "home",
  "library",
  "player",
  "playlists",
  "settings",
];

export const mobileNavigationTarget = (active, managementIds = []) => {
  if (
    active === "manage" ||
    managementIds.includes(active)
  ) {
    return "settings";
  }
  if (active === "discover") return "home";
  if (active === "me" || active === "search") return "library";
  return active;
};
