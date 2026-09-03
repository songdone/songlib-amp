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
import { installPromptStore } from "./lib/installPrompt";
import { BRAND } from "./config/brand";
import { App } from "./app/App";

if (window.isSecureContext && "serviceWorker" in navigator) {
  let refreshingForWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForWorker) return;
    refreshingForWorker = true;
    window.location.reload();
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
