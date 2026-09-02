/**
 * 导航模型。
 *
 * 重构前的分组是"音乐 / 工具 / 系统"—— 这是按技术类型分的，
 * 用户不会想"我要用一个工具"，他想的是"我要把这批歌的标签改对"。
 * 而且"音乐工具"是一个装了五样不相干东西的杂物抽屉
 * （文件标签、Plex 元数据、下载入库、音乐源、任务中心），
 * 每样都要先点进去再选一次；"设置"还同时出现在主导航和这个抽屉里。
 *
 * 现在按用户处于什么状态分两组：
 *
 *   听音乐  —— 日常使用。所有人可见。
 *   整理曲库 —— 维护收藏。只有管理员可见，且每项都是独立的一级目的地，
 *              不再藏在一个按钮后面。
 *
 * 设置单独放在最后，不属于任何一组 —— 它是低频的系统配置，
 * 不是一类日常任务。
 */

import {
  Activity,
  ArrowDownToLine,
  FolderTree,
  Home,
  Library,
  ListMusic,
  Play,
  Settings,
  Sparkles,
  WandSparkles,
} from "lucide-react";

/** 分组顺序即侧栏顺序。 */
export const NAV_GROUPS = Object.freeze({
  listen: "听音乐",
  manage: "整理曲库",
});

export const nav = [
  // --- 听音乐 ---
  { id: "home", label: "首页", icon: Home, group: "listen" },
  { id: "library", label: "音乐库", icon: Library, group: "listen" },
  { id: "playlists", label: "歌单", icon: ListMusic, group: "listen" },
  { id: "discover", label: "发现", icon: Sparkles, group: "listen" },
  { id: "player", label: "正在播放", icon: Play, group: "listen" },

  // --- 整理曲库（管理员） ---
  {
    id: "download",
    label: "下载入库",
    icon: ArrowDownToLine,
    group: "manage",
    admin: true,
  },
  {
    id: "local",
    label: "文件与标签",
    icon: FolderTree,
    group: "manage",
    admin: true,
  },
  {
    id: "scrape",
    label: "封面与歌词",
    icon: WandSparkles,
    group: "manage",
    admin: true,
  },
  { id: "tasks", label: "任务", icon: Activity, group: "manage", admin: true },

  // --- 不分组 ---
  { id: "settings", label: "设置", icon: Settings },
];

/**
 * "音乐工具"聚合页仍然保留（旧书签和移动端"更多"会用到），
 * 但它现在只是这几个一级目的地的索引，不再是唯一入口。
 * 描述写"你能在这里做什么"，不写模块清单。
 */
export const managementNav = [
  {
    id: "download",
    label: "下载入库",
    icon: ArrowDownToLine,
    desc: "搜歌、下载，确认无误后再放进正式曲库",
  },
  {
    id: "local",
    label: "文件与标签",
    icon: FolderTree,
    desc: "改歌名歌手专辑，整理目录结构，改错了能撤回",
  },
  {
    id: "scrape",
    label: "封面与歌词",
    icon: WandSparkles,
    desc: "补齐缺的专辑封面、歌词、歌手照片和简介",
  },
  {
    id: "sources",
    label: "音乐源",
    icon: Activity,
    desc: "管理你有权使用的下载来源",
  },
  {
    id: "tasks",
    label: "任务",
    icon: Activity,
    desc: "看后台在跑什么，处理需要确认和重试的",
  },
];

/** 侧栏里哪一项该高亮。子页面归到它所属的一级目的地。 */
export const activeNavId = (active) => {
  if (active === "sources" || active === "manage") return "download";
  if (active === "me" || active === "search") return "library";
  return active;
};

/**
 * 页面标题与副标题。
 *
 * 副标题的规矩：只在标题不足以说明"这里能干什么"时才写，
 * 而且写用户能做的事，不写模块清单。
 * 重构前多数副标题是内部状态枚举（"运行中、待确认、失败和历史任务分开处理"），
 * 读起来像项目说明书。
 */
/**
 * 顶栏只写页名，不写副标题。
 *
 * 顶栏标题是"你在哪"，页面正文里的那句话是"这一页能做什么"。
 * 两处都写就会出现同一件事说两遍 —— 顶栏"改标签、整理目录，改错了能撤回"
 * 紧接着正文"改歌名、歌手、专辑这些写在音频文件里的信息…"。
 *
 * 需要说明的页面，把说明写在页面自己的正文里；那里有空间讲清楚。
 */
export const pageMeta = {
  home: ["首页", ""],
  library: ["音乐库", ""],
  playlists: ["歌单", ""],
  player: ["正在播放", ""],
  discover: ["发现", ""],
  me: ["我的", ""],
  search: ["搜索", ""],
  manage: ["整理曲库", ""],
  local: ["文件与标签", ""],
  scrape: ["封面与歌词", ""],
  download: ["下载入库", ""],
  sources: ["音乐源", ""],
  tasks: ["任务", ""],
  settings: ["设置", ""],
};
