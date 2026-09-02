import { BookOpenText, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
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
        setStatus("安装已取消。浏览器再次允许安装时，这里会重新出现安装入口。");
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
    <aside className="pwa-prompt panel">
      <button className="icon-button" onClick={dismiss} aria-label="关闭安装提示" title="稍后再说">
        <X />
      </button>
      <div className="pwa-icon">
        <img src="/icons/icon-192.png" alt="" />
      </div>
      <div>
        <strong>安装音屿轻应用</strong>
        <p>{guidance.summary}</p>
        {helpOpen && (
          <div className="pwa-install-help" role="status">
            {guidance.detail}
          </div>
        )}
        {status && <div className="pwa-install-status" role="status">{status}</div>}
        <div>
          <button className="primary small" onClick={install}>
            {event ? <Download /> : <BookOpenText />}
            {guidance.actionLabel}
          </button>
          <button className="secondary small" onClick={dismiss}>
            稍后再说
          </button>
        </div>
      </div>
    </aside>
  );
}
