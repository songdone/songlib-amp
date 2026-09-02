/**
 * 移动端底部导航模型。
 *
 * 桌面侧栏可以放九个目的地，手机底栏不行 —— 五个是拇指能舒服覆盖的上限，
 * 再多每个就窄到点不准。所以移动端只放四个"听音乐"的目的地，
 * 第五格是"更多"，进去是整理曲库和设置。
 *
 * 这里刻意不直接复用 nav 数组：桌面和移动的取舍不同，
 * 强行共用一份会让两边互相牵制。改导航时两处都要过一遍。
 */

/** 底栏的五个格子。顺序即从左到右。 */
export const mobileNavigationIds = ["home", "library", "player", "playlists", "more"];

/** 底栏标签。比桌面更短 —— 格子只有约 70px 宽。 */
export const mobileNavigationLabels = {
  home: "首页",
  library: "曲库",
  player: "播放",
  playlists: "歌单",
  more: "更多",
};

/**
 * "更多"格子点进去落到哪。
 * 管理员进整理曲库的索引页，普通听众直接进设置 —— 他们没有整理权限，
 * 让他们先看一眼"你没有权限"是没意义的。
 */
export const mobileMoreTarget = (isAdmin) => (isAdmin ? "manage" : "settings");

/**
 * 当前页面应该高亮底栏的哪一格。
 *
 * 关键约束：任何时刻**有且只有一格**是高亮的。
 * 重构前这里出过 bug —— 移动端会同时高亮"播放""工具""设置"三格，
 * 因为三个判断各自独立返回 true。所以这个函数只有一个出口，逐条 return。
 *
 * @param active         当前页面 id
 * @param managementIds  属于"整理曲库"的页面 id，它们都归到"更多"
 */
export const mobileNavigationTarget = (active, managementIds = []) => {
  // 底栏直接有的格子，原样高亮。
  if (["home", "library", "player", "playlists"].includes(active)) return active;
  // 整理曲库下的所有页面、聚合页、以及设置，都归到"更多"。
  if (active === "manage" || active === "settings") return "more";
  if (managementIds.includes(active)) return "more";
  // 从首页进去的子页面算首页。
  if (active === "discover") return "home";
  // 搜索和"我的"都是从曲库进去的。
  if (active === "me" || active === "search") return "library";
  return "more";
};
