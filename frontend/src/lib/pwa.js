export const pwaSecureOrigin = ({ protocol, hostname, isSecureContext }) =>
  Boolean(
    isSecureContext ||
      protocol === "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(hostname),
  );

/**
 * 判断当前浏览器。
 *
 * 只用来选一句正确的操作说明，不用来开关任何功能 —— 能不能装由
 * `beforeinstallprompt` 有没有来决定，不由这里猜。
 */
export const pwaBrowser = ({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) => {
  const ua = String(userAgent);
  const combined = `${ua} ${platform}`;
  // iPadOS 13+ 的 Safari 自报 Macintosh，用触点数把它和真 Mac 分开。
  const iosLike =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh|macintel/i.test(combined) && Number(maxTouchPoints || 0) > 1);
  const chromium = /chrome|chromium|crios|edg|edga|edgios|opr/i.test(ua);
  // iOS 上所有浏览器都是 WebKit 外壳，Chrome/Edge 也一样没有安装 API。
  const safari = !chromium && /safari/i.test(ua);
  const firefox = /firefox|fxios/i.test(ua);
  const macDesktop = /macintosh|macintel/i.test(combined) && !iosLike;
  return { iosLike, chromium, safari, firefox, macDesktop };
};

export const pwaInstallGuidance = ({
  hasPrompt,
  secureOrigin,
  userAgent,
  platform = "",
  maxTouchPoints = 0,
}) => {
  const { iosLike, chromium, safari, firefox, macDesktop } = pwaBrowser({
    userAgent,
    platform,
    maxTouchPoints,
  });

  // 只有真的拿到了 beforeinstallprompt 才说"能装"。
  if (hasPrompt)
    return {
      actionLabel: "安装应用",
      summary: "已满足安装条件，可作为独立窗口运行。",
      detail: "",
      canInstall: true,
    };

  /*
   * iPhone / iPad。
   *
   * Safari 没有安装 API（`beforeinstallprompt` 是 Chromium 独有的），
   * 所以这里**不承诺"直接安装"**，只给一句到位的手动步骤。
   * iOS 上的 Chrome / Edge 也是 WebKit 外壳，同样没有安装 API，
   * 但它们的分享菜单里确实有"添加到主屏幕"。
   */
  if (iosLike)
    return {
      actionLabel: "查看添加方法",
      summary: chromium
        ? "iOS 上任何浏览器都没有一键安装，用分享菜单添加到主屏幕。"
        : "iPhone 与 iPad 用 Safari 的分享菜单添加到主屏幕。",
      detail: secureOrigin
        ? "点屏幕底部（或右上角）的分享按钮 ⇧ ，在列表里往下找“添加到主屏幕”，再点“添加”。"
        : "点分享按钮 ⇧ →“添加到主屏幕”。当前是内网 HTTP 地址，加到主屏幕后登录、播放、管理都正常，只是不会启用离线缓存这类需要安全上下文的能力。",
      canInstall: false,
    };

  if (!secureOrigin)
    return {
      actionLabel: "查看 HTTPS 要求",
      summary: "当前地址使用 HTTP，浏览器不会提供应用安装窗口。",
      detail:
        "请先在 NAS 反向代理中为音屿启用 HTTPS，再用 HTTPS 地址打开。完成后浏览器会自动开放安装入口。",
      canInstall: false,
    };

  /*
   * 桌面版 Safari。
   *
   * 这一条以前是缺的 —— macOS Safari 落到最后那个兜底分支，被告知
   * "在 Chrome 或 Edge 的地址栏里找安装音屿"，而用户明明在 Safari 里。
   * Safari 17 起可以"添加到程序坞"，那才是这里该说的话。
   */
  if (safari && macDesktop)
    return {
      actionLabel: "查看添加方法",
      summary: "Safari 用菜单栏「文件」→「添加到程序坞」。",
      detail:
        "Safari 没有一键安装的接口（那是 Chrome / Edge 独有的）。在 Safari 里打开菜单栏“文件”→“添加到程序坞”，确认名称后点“添加”，音屿就会作为独立窗口出现在程序坞里。需要 macOS Sonoma 及以上；更老的系统请改用 Chrome 或 Edge。",
      canInstall: false,
    };

  // Firefox 桌面版根本不支持安装 PWA，别让人白找菜单。
  if (firefox)
    return {
      actionLabel: "查看可用方式",
      summary: "Firefox 桌面版不支持把网页装成应用。",
      detail:
        "这是 Firefox 自身的限制，不是音屿的问题。想要独立窗口，请用 Chrome、Edge（地址栏右侧的安装图标），或 macOS 上的 Safari（“文件”→“添加到程序坞”）。",
      canInstall: false,
    };

  if (chromium)
    return {
      actionLabel: "查看安装方法",
      summary: "浏览器还没开放安装窗口，多半是已经装过了。",
      detail:
        "先确认音屿没有装过（装过的话安装入口会消失）。没装过就看地址栏右侧有没有安装图标 ⊕ ，或者从右上角菜单里找“安装音屿”。都没有的话刷新一次页面——安装条件是浏览器在页面加载后判定的。",
      canInstall: false,
    };

  return {
    actionLabel: "查看安装方法",
    summary: "这个浏览器没有提供应用安装入口。",
    detail:
      "请改用 Chrome 或 Edge（地址栏右侧的安装图标），iPhone / iPad 用 Safari 的“分享”→“添加到主屏幕”，macOS Safari 用“文件”→“添加到程序坞”。",
    canInstall: false,
  };
};
