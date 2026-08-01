export const mobileNavigationIds = [
  "home",
  "discover",
  "library",
  "playlists",
  "me",
];

export const mobileNavigationTarget = (active, managementIds = []) => {
  if (
    active === "settings" ||
    active === "manage" ||
    managementIds.includes(active)
  ) {
    return "me";
  }
  return active;
};
