/**
 * 应用入口。这里只做三件事：注册 Service Worker、挂载 React 根、
 * 广播启动完成事件。任何界面逻辑都不应该回到这个文件。
 *
 * 组件按 feature 分布在 src/features/，跨 feature 复用的在 src/components/，
 * 纯函数在 src/lib/。
 */
import { createRoot } from "react-dom/client";
import "./styles/index.css";
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
window.dispatchEvent(new Event("songlib:started"));
