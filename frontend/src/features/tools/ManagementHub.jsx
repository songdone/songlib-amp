import { BookOpenText, ChevronRight, CircleAlert, Gauge, Music2 } from "lucide-react";
import { fmt } from "../../lib/format";
import { managementNav } from "../../lib/nav-model";

export function ManagementHub({ navigate, stats, jobs, permissions = [] }) {
  const waiting = jobs.filter((job) => job.status === "waiting_confirm").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const can = (permission) =>
    permissions.includes(permission) || permissions.includes("manage_users");
  const visibleManagement = managementNav.filter((item) =>
    item.id === "sources"
      ? can("manage_sources")
      : item.id === "settings"
        ? false
        : can("manage_library"),
  );
  const managementGroups = [
    {
      id: "catalog",
      eyebrow: "文件与下载",
      title: "标签写入、歌曲下载与入库",
      items: visibleManagement.filter((item) =>
        ["local", "download"].includes(item.id),
      ),
    },
    {
      id: "metadata",
      eyebrow: "PLEX 资料",
      title: "歌手海报、简介与专辑封面",
      items: visibleManagement.filter((item) => item.id === "scrape"),
    },
    {
      id: "operations",
      eyebrow: "连接与运行",
      title: "服务、队列与故障",
      items: visibleManagement.filter((item) =>
        ["sources", "tasks"].includes(item.id),
      ),
    },
  ].filter((group) => group.items.length);
  const metrics = [
    [Music2, "歌曲", stats?.tracks, "catalog"],
    [CircleAlert, "待确认", waiting, waiting ? "warning" : "quiet"],
    [CircleAlert, "失败任务", failed, failed ? "danger" : "quiet"],
    [BookOpenText, "缺歌词", stats?.missingLyrics, "info"],
  ];
  return (
    <div className="page manage-page refined-manage-page">
      <section className="page-intro">
        <h1>音乐工具</h1>
        <p>下载、标签写入、Plex 资料补全和任务状态都在首屏直接进入。</p>
      </section>
      <section className="manage-metrics" aria-label="曲库状态摘要">
        {metrics.map(([Icon, label, value, tone]) => (
          <article className={`manage-metric ${tone}`} key={label}>
            <span className="manage-metric-icon"><Icon /></span>
            <div>
              <small>{label}</small>
              <strong>{fmt(value)}</strong>
            </div>
          </article>
        ))}
      </section>
      <section className="manage-workspace">
        {managementGroups.map((group) => (
          <article className="manage-section" key={group.id}>
            <header>
              <span>{group.eyebrow}</span>
              <h2>{group.title}</h2>
            </header>
            <div className="manage-menu">
              {group.items.map((item) => (
                <button
                  className="manage-menu-row"
                  key={item.id}
                  onClick={() => navigate(item.id)}
                >
                  <span className="manage-menu-icon"><item.icon /></span>
                  <span className="manage-menu-copy">
                    <strong>{item.label}</strong>
                    <small>{item.desc}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
