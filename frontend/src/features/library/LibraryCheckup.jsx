/**
 * 整库体检。
 *
 * 为什么要有这一页：修东西的工具本来就都在（补封面、补标签、整理目录、
 * 同步 Plex），但只有已经知道自己有这个问题的人才会去点。
 * 体检把"37 首缺封面"变成一个链接，点进去筛选条件已经填好了。
 *
 * 三条自己给自己定的规矩：
 *
 * 1. 每一条问题都必须带"处理入口"。只报数不给出路等于让用户自己找。
 *    页面映射由后端一起返回（check.page / check.filter），
 *    前端不另存一份，否则两边会漂。
 * 2. 重复文件只**建议**保留哪个，绝不自动删。判重会错，
 *    错一次用户就少一个录音版本。
 * 3. 没有问题的检查项不列出来。一屏"0 首缺封面 / 0 首缺歌词"
 *    是噪音，不是信息。
 */

import {
  CircleAlert,
  CircleCheck,
  Copy,
  FileQuestion,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { EmptyState, Section, SectionHeader } from "../../components/ui/Layout";
import { PathText } from "../../components/ui/PathText";
import { PageLoader } from "../../components/PageLoader";
import { api } from "../../lib/api";
import { fmt, timeAgo } from "../../lib/format";

/** 后端返回的 page 是路由名，这里给它一个能读的中文说法。 */
const DESTINATIONS = {
  scrape: "封面与歌词",
  local: "文件与标签",
};

const SEVERITY_TONE = { danger: "danger", warning: "warning", info: "neutral" };

const formatSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatDuration = (seconds) => {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

export function LibraryCheckup({ navigate, onJumpToFilter, onRescan }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await api("/api/local/health"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
  }, []);

  if (loading && !report) return <PageLoader />;

  const checks = report?.checks || [];
  const duplicates = report?.duplicates || [];
  const orphans = report?.missingOnDisk || [];

  return (
    <>
      <Section reveal>
        <SectionHeader
          title="曲库体检"
          note={
            report?.checkedAt
              ? `${fmt(report.total)} 个文件 · 检查于 ${timeAgo(report.checkedAt)}`
              : "扫一遍曲库，把要处理的都列出来"
          }
          actions={
            <Button size="sm" icon={RefreshCw} loading={loading} onClick={run}>
              重新检查
            </Button>
          }
        />

        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}

        {report?.clean ? (
          <EmptyState
            icon={CircleCheck}
            title="没有待处理项"
            text="封面、歌词、标签、目录和 Plex 对照都是齐的"
          />
        ) : (
          <ul className="checkup-list">
            {checks.map((check) => (
              <li key={check.id} className={`checkup-item tone-${check.severity}`}>
                <span className="checkup-item__count">{fmt(check.count)}</span>
                <span className="checkup-item__text">
                  <strong>{check.label}</strong>
                  <small>{check.hint}</small>
                </span>
                {/*
                  这个按钮是这一页存在的理由：点它等于"带着筛选条件跳到
                  能修它的地方"。判断依据全部来自后端返回的 page/filter，
                  界面不猜。重复和已丢失两条没有对应筛选，所以不给按钮 ——
                  它们的清单就在下面。
                */}
                {check.filter || check.page !== "local" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      check.page === "local" && check.filter
                        ? onJumpToFilter?.(check.filter)
                        : navigate?.(check.page)
                    }
                  >
                    去{DESTINATIONS[check.page] || "处理"}
                  </Button>
                ) : (
                  <Badge tone={SEVERITY_TONE[check.severity]}>看下面</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {duplicates.length > 0 && (
        <Section reveal>
          <SectionHeader
            title="同一首歌存了多份"
            note={`${fmt(report.duplicateTotal)} 组${
              report.duplicateTotal > duplicates.length
                ? `，先列出最值得看的 ${duplicates.length} 组`
                : ""
            }`}
          />
          {/* 刻意不给"一键删除重复"。判重会错，错一次就是少一个录音版本。
              这里只标出建议保留的那个，删不删由人在文件浏览里自己做。 */}
          <Notice tone="info" icon={Copy}>
            这里只标出建议留下的那份（码率最高），不会自动删任何东西。
            要清理就去「浏览与筛选」里搜这个曲名。
          </Notice>
          <ul className="dupe-list">
            {duplicates.map((group) => (
              <li key={group.key} className="dupe-group">
                <header>
                  <strong>{group.title}</strong>
                  <small>{group.artist || "未知歌手"}</small>
                  <Badge tone="neutral">{group.reason}</Badge>
                </header>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id} className={item.keep ? "is-keep" : undefined}>
                      <Badge tone={item.keep ? "success" : "neutral"}>
                        {item.keep ? "建议留这个" : "多余"}
                      </Badge>
                      <PathText path={item.path} clip="start" />
                      <span>
                        {[
                          item.ext.replace(".", "").toUpperCase(),
                          item.bitrate ? `${item.bitrate}kbps` : "",
                          item.size ? formatSize(item.size) : "",
                          item.duration ? formatDuration(item.duration) : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {orphans.length > 0 && (
        <Section reveal>
          <SectionHeader
            title="记录还在，文件没了"
            note={`${fmt(report.missingOnDiskTotal)} 条`}
          />
          <Notice tone="warning" icon={FileQuestion}>
            这些文件在曲库索引里，但磁盘上找不到 —— 通常是在音屿之外手动挪过或删过。
            重新扫一次音乐目录就会清掉，不会动任何还存在的文件。
          </Notice>
          <ul className="orphan-list">
            {orphans.map((item) => (
              <li key={item.id}>
                <PathText path={item.path} clip="start" />
                <small>
                  {[item.artist, item.album].filter(Boolean).join(" · ") || "没有标签信息"}
                </small>
              </li>
            ))}
          </ul>
          <ButtonGroup>
            {/* 直接排一次扫描任务，不是"跳回上面自己点" ——
                页面顶部那个按钮就在同一屏，让用户滚上去点是多余的一步。 */}
            <Button
              size="sm"
              variant="primary"
              icon={Stethoscope}
              onClick={() => onRescan?.()}
            >
              重新扫描
            </Button>
          </ButtonGroup>
        </Section>
      )}
    </>
  );
}
