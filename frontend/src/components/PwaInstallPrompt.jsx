/**
 * "添加到桌面" 提示条。
 *
 * 重构掉的：
 * - `className="pwa-prompt panel"`。旧的 .panel 是一段硬编码深色渐变
 *   （linear-gradient(145deg, #1f2125, #191b1e)），浅色主题下这张卡
 *   会是整屏唯一一块黑的。现在用 --surface-* token。
 * - .primary / .secondary / .icon-button 三个旧类名。
 * - 关闭按钮 aria-label 说"关闭安装提示"、title 说"稍后再说"，
 *   两个名字不一致，读屏和悬停提示对不上。
 *
 * 保留的：install() 里的 `event.prompt()`。那是 BeforeInstallPrompt
 * 的浏览器 API，不是原生对话框，不在"清掉 confirm/prompt"的范围里。
 */

import { BookOpenText, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ButtonGroup, IconButton } from "./ui/Button";
import { pwaInstallGuidance, pwaSecureOrigin } from "../lib/pwa";

export function PwaInstallPrompt() {
  const [event, setEvent] = useState(null),
    [visible, setVisible] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [status, setStatus] = useState("");
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone;
  const secureOrigin = pwaSecureOrigin({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    isSecureContext: window.isSecureContext,
  });
  const guidance = pwaInstallGuidance({
    hasPrompt: Boolean(event),
    secureOrigin,
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    maxTouchPoints: window.navigator.maxTouchPoints,
  });
  useEffect(() => {
    if (standalone || localStorage.getItem("songlib-pwa-dismissed") === "1")
      return;
    const timer = setTimeout(() => setVisible(true), 2600);
    const onPrompt = (e) => {
      e.preventDefault();
      setEvent(e);
      setVisible(true);
      setHelpOpen(false);
      clearTimeout(timer);
    };
    const onInstalled = () => {
      setVisible(false);
      setEvent(null);
      localStorage.setItem("songlib-pwa-dismissed", "1");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [standalone]);
  if (!visible || standalone) return null;
  const install = async () => {
    if (event) {
      setStatus("");
      await event.prompt();
      const result = await event.userChoice.catch(() => ({
        outcome: "dismissed",
      }));
      setEvent(null);
      if (result.outcome === "accepted") {
        localStorage.setItem("songlib-pwa-dismissed", "1");
        setVisible(false);
      } else {
        setStatus("已取消，入口保留在这里");
        setHelpOpen(true);
      }
    } else {
      setHelpOpen((value) => !value);
      setStatus("");
    }
  };
  const dismiss = () => {
    localStorage.setItem("songlib-pwa-dismissed", "1");
    setVisible(false);
  };
  return (
    <aside className="pwa-prompt">
      <IconButton
        icon={X}
        size="sm"
        label="不再提示"
        className="pwa-prompt__close"
        onClick={dismiss}
      />
      <div className="pwa-prompt__icon">
        <img src="/icons/icon-192.png" alt="" />
      </div>
      <div className="pwa-prompt__body">
        <strong>装到桌面</strong>
        <p>{guidance.summary}</p>
        {helpOpen && (
          <div className="pwa-prompt__help" role="status">
            {guidance.detail}
          </div>
        )}
        {status && (
          <div className="pwa-prompt__status" role="status">
            {status}
          </div>
        )}
        <ButtonGroup>
          <Button
            size="sm"
            variant="primary"
            icon={event ? Download : BookOpenText}
            onClick={install}
          >
            {guidance.actionLabel}
          </Button>
          <Button size="sm" variant="quiet" onClick={dismiss}>
            不用了
          </Button>
        </ButtonGroup>
      </div>
    </aside>
  );
}
