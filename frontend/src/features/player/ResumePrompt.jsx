/**
 * "上次听到 3:20，接着听？"
 *
 * 这是**提议**，不是自动跳。所以它长成一条可以直接无视的提示条，
 * 而不是一个必须回答的弹窗 —— 用户什么都不点，歌照样从头放。
 *
 * 10 秒后自动消失：这条提示的有效期就是歌刚开始那一小会儿。
 * 一直挂着会挡住迷你播放器，而那时候它已经没有意义了
 * （都听到 1:30 了，谁还要跳回 3:20 之前的位置）。
 */

import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { formatTime } from "../../lib/format";

const AUTO_DISMISS_MS = 10_000;

export function ResumePrompt({ offer, onAccept, onDismiss }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!offer) return undefined;
    setLeaving(false);
    const timer = setTimeout(() => setLeaving(true), AUTO_DISMISS_MS - 400);
    const done = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(done);
    };
  }, [offer?.trackKey]);

  if (!offer) return null;

  return (
    <aside
      className={`resume-prompt${leaving ? " is-leaving" : ""}`}
      role="status"
    >
      <span className="resume-prompt__text">
        <strong>上次听到 {formatTime(offer.position)}</strong>
        <small>
          {/* 说清是从哪台设备停下的 —— 这句是"跨设备"这件事唯一
              让人看得见的地方。同一台设备上就不必强调了。 */}
          {offer.device ? `在${offer.device}上停下的` : "接着上次的位置"}
        </small>
      </span>
      <Button size="sm" variant="primary" icon={RotateCcw} onClick={onAccept}>
        接着听
      </Button>
      <IconButton
        icon={X}
        size="sm"
        label="从头播放"
        onClick={onDismiss}
      />
    </aside>
  );
}
