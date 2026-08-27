export const pwaSecureOrigin = ({ protocol, hostname, isSecureContext }) =>
  Boolean(
    isSecureContext ||
      protocol === "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(hostname),
  );

export const pwaInstallGuidance = ({
  hasPrompt,
  secureOrigin,
  userAgent,
  platform = "",
  maxTouchPoints = 0,
}) => {
  const appleMobile =
    /iphone|ipad|ipod/i.test(userAgent || "") ||
    (/macintosh|macintel/i.test(`${userAgent || ""} ${platform || ""}`) &&
      Number(maxTouchPoints || 0) > 1);
  if (hasPrompt)
    return {
      actionLabel: "安装应用",
      summary: "已满足安装条件，可作为独立窗口运行。",
      detail: "",
    };
  if (appleMobile)
    return {
      actionLabel: "查看添加方法",
      summary: secureOrigin
        ? "iPhone 与 iPad 需要从 Safari 的分享菜单添加到主屏幕。"
        : "当前内网 HTTP 地址仍可添加到主屏幕并正常登录、播放和管理音乐。",
      detail: secureOrigin
        ? "请使用 Safari 打开当前地址，选择“分享”→“添加到主屏幕”。"
        : "在 Safari 中选择“分享”→“添加到主屏幕”。HTTP 不会启用离线缓存、推送等安全上下文增强能力，但无需让内网访问绕行公网；如需这些能力，可在 NAS 上就地终止 HTTPS。",
    };
  if (!secureOrigin)
    return {
      actionLabel: "查看 HTTPS 要求",
      summary: "当前地址使用 HTTP，浏览器不会提供应用安装窗口。",
      detail:
        "请先在 NAS 反向代理中为音屿启用 HTTPS，再用 HTTPS 地址打开。完成后浏览器会自动开放安装入口。",
    };
  return {
    actionLabel: "查看安装方法",
    summary: "浏览器暂未开放原生安装窗口。",
    detail:
      "请确认应用尚未安装，并在 Chrome 或 Edge 地址栏、应用菜单中选择“安装音屿”。浏览器满足安装条件后，此按钮会自动切换为“安装应用”。",
  };
};
