import { Activity, ArrowDownToLine, FolderTree, Gauge, Home, Library, ListMusic, Play, Settings, WandSparkles, Wifi } from "lucide-react";

export const nav = [
  { id: "home", label: "首页", icon: Home, group: "音乐" },
  { id: "library", label: "音乐库", icon: Library, group: "音乐" },
  { id: "player", label: "正在播放", icon: Play, group: "音乐" },
  { id: "playlists", label: "歌单", icon: ListMusic, group: "音乐" },
  { id: "manage", label: "音乐工具", icon: Gauge, group: "工具", admin: true },
  { id: "settings", label: "设置", icon: Settings, group: "系统" },
];

export const managementNav = [
  {
    id: "local",
    label: "文件与标签",
    icon: FolderTree,
    desc: "浏览音乐文件、写入真实音频标签并撤销整理操作",
  },
  {
    id: "scrape",
    label: "Plex 元数据",
    icon: WandSparkles,
    desc: "歌手海报、背景、中文简介、专辑封面与歌词补齐",
  },
  {
    id: "download",
    label: "歌曲下载与入库",
    icon: ArrowDownToLine,
    desc: "下载到当前设备或 NAS，并完成标签与入库检查",
  },
  {
    id: "sources",
    label: "音乐源管理",
    icon: Wifi,
    desc: "添加授权来源并检查连接状态",
  },
  {
    id: "tasks",
    label: "任务中心",
    icon: Activity,
    desc: "运行中、待确认、失败与历史任务",
  },
  {
    id: "settings",
    label: "系统设置",
    icon: Settings,
    desc: "Plex、账号、安全、日志与偏好",
  },
];

export const activeNavId = (active) =>
  active === "manage" ||
  managementNav.some((item) => item.id !== "settings" && item.id === active)
    ? "manage"
    : active === "discover"
      ? "home"
      : active === "me" || active === "search"
        ? "library"
        : active;

export const pageMeta = {
  home: ["首页", ""],
  library: ["音乐库", "歌手、专辑与单曲"],
  playlists: ["歌单", "收藏、导入与迁移"],
  player: ["正在播放", ""],
  discover: ["为你推荐", "熟悉的旋律，也有新的发现"],
  me: ["收藏与历史", "你的音乐足迹"],
  manage: ["音乐工具", "下载、标签与 Plex 资料"],
  search: ["搜索", "歌曲、艺人、专辑与歌单"],
  local: ["文件与标签", "浏览、写入标签与安全回滚"],
  scrape: ["Plex 元数据", "歌手海报、简介、背景与专辑封面"],
  download: ["歌曲下载与入库", "下载到设备或 NAS，并确认入库"],
  sources: ["音乐源管理", "授权来源、接口识别与可用性"],
  tasks: ["任务中心", "进度、失败恢复与历史"],
  settings: ["设置", "账号、连接与存储"],
};
