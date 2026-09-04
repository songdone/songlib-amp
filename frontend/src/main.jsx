/**
 * 应用入口。这里只做四件事：抢在 React 之前捕获安装事件、注册
 * Service Worker、挂载 React 根、广播启动完成事件。
 * 任何界面逻辑都不应该回到这个文件。
 *
 * 组件按 feature 分布在 src/features/，跨 feature 复用的在 src/components/，
 * 纯函数在 src/lib/。
 */
import { createRoot } from "react-dom/client";
import "./styles/index.css";
/* 这一行是副作用导入，位置有意义：`beforeinstallprompt` 只发一次，
   而且发得很早（页面加载后不久）。等到登录后 PwaInstallPrompt 挂载再监听
   就永远收不到 —— 这就是"Chrome/Edge 不弹窗"的根因。必须在这里先接住。 */
import { pendingRequests } from "./lib/api";
import { installPromptStore } from "./lib/installPrompt";
import { BRAND } from "./config/brand";
import { App } from "./app/App";

if (window.isSecureContext && "serviceWorker" in navigator) {
  /*
   * Service Worker 换代之后刷新一次，让页面用上新版本的静态资源。
   *
   * 但**不能说刷就刷** —— 刷新会中止正在飞的请求。线上抓到过
   * `ERR_ABORTED /api/auth/login`：用户刚点登录，新版本的 SW 接管，
   * 页面刷新，请求没了、错误提示也被刷新抹掉，表现就是"点了没反应"。
   * 每次发版之后的第一次操作都可能撞上。
   *
   * 两个约束：
   *  1. 首次接管不刷。第一次加载时本来就没有旧的 controller，
   *     资源已经是新的，刷新纯属白刷一次。
   *  2. 有请求在飞就等它落地，最多等 15 秒。等不到也刷 ——
   *     总不能因为一个卡住的请求就永远留在旧版本上。
   */
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshingForWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForWorker || !hadController) return;
    refreshingForWorker = true;
    const deadline = Date.now() + 15000;
    const reloadWhenIdle = () => {
      if (pendingRequests() === 0 || Date.now() > deadline) {
        window.location.reload();
        return;
      }
      window.setTimeout(reloadWhenIdle, 300);
    };
    reloadWhenIdle();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(<App />);
document.documentElement.dataset.songlibStarted = BRAND.version;
// 给 interact-check 一个可断言的落点：捕获仓装好了没有。
document.documentElement.dataset.songlibInstallCapture =
  installPromptStore ? "ready" : "missing";
window.dispatchEvent(new Event("songlib:started"));
