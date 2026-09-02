import { Activity, ArrowDownToLine, Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, RefreshCw, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import { Empty } from "../../components/Empty";
import { SectionHead } from "../../components/SectionHead";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";

/**
 * 任务按处理方式分四类，顺序就是用户该关注的顺序：
 * 正在跑的、等我拍板的、需要重试的、已经完事的。
 * id 与 groups 的键一致，磁贴同时充当筛选器。
 */
const TASK_FILTERS = [
  { id: "running", icon: LoaderCircle, label: "正在执行", tone: "accent" },
  { id: "confirm", icon: WandSparkles, label: "等我确认", tone: "warning" },
  { id: "failed", icon: CircleAlert, label: "需要重试", tone: "danger" },
  { id: "history", icon: Check, label: "已完成", tone: "success" },
];

export function Tasks({ jobs, refresh, navigate }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("running");
  const inspect = async (id) => {
    try {
      setDetail(await api(`/api/jobs/${id}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const control = async (job, action) => {
    if (!confirm(`${action === "retry" ? "重试" : "安全取消"}：${job.title}？`)) return;
    try {
      await api(`/api/jobs/${job.id}/${action}`, { method: "POST" });
      setDetail(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const label = (status) =>
    status === "running"
      ? "执行中"
      : status === "completed"
        ? "完成"
        : status === "failed"
          ? "失败"
          : status === "waiting_confirm"
            ? "待确认"
            : status === "cancelled"
              ? "已取消"
              : "排队";
  const groups = {
    running: jobs.filter((j) => ["running", "queued"].includes(j.status)),
    confirm: jobs.filter((j) => j.status === "waiting_confirm"),
    failed: jobs.filter((j) => j.status === "failed"),
    history: jobs.filter(
      (j) =>
        !["running", "queued", "waiting_confirm", "failed"].includes(j.status),
    ),
    all: jobs,
  };
  const visible = groups[filter] || jobs;
  return (
    <div className="page tasks-page">
      {/* 顶栏已经显示"任务"，这里不重复页名；
          说明改成告诉用户下面这几个数字是干什么的。 */}
      <SectionHead
        title="后台在跑什么"
        note="点上面的方块可以按类别筛选"
        action={
          <button className="secondary small" onClick={refresh}>
            <RefreshCw />
            刷新
          </button>
        }
      />
      {error && (
        <div className="inline-error">
          <CircleAlert />
          {error}
        </div>
      )}
      {/* 四个磁贴同时是当前筛选器。选中态用 aria-pressed 表达，
          读屏能听出"哪一类正在被查看"。 */}
      <StatGrid>
        {TASK_FILTERS.map(({ id, icon, label, tone }) => (
          <StatTile
            key={id}
            icon={icon}
            tone={tone}
            value={groups[id].length}
            label={label}
            selected={filter === id}
            onClick={() => setFilter(id)}
          />
        ))}
      </StatGrid>
      <section className="panel task-list">
        <div className="task-list-head">
          <span>任务</span>
          <span>状态</span>
          <span>时间</span>
        </div>
        {visible.length ? (
          visible.map((job) => (
            <div
              className="task-detail"
              key={job.id}
              onClick={() => inspect(job.id)}
            >
              <div className={`job-state ${job.status}`}>
                {job.status === "running" ? (
                  <LoaderCircle className="spin" />
                ) : job.status === "completed" ? (
                  <Check />
                ) : job.status === "failed" ? (
                  <CircleAlert />
                ) : job.status === "waiting_confirm" ? (
                  <WandSparkles />
                ) : (
                  <Clock3 />
                )}
              </div>
              <div className="task-copy">
                <strong>{job.title}</strong>
                <span>
                  {job.error_message ||
                    job.message ||
                    `任务 #${job.id} · 发起时间 ${timeAgo(job.created_at)}`}
                </span>
                {!["queued", "running", "waiting_confirm"].includes(job.status) && (
                  <small>成功 {job.success_count || 0} · 失败 {job.failed_count || 0} · 跳过 {job.skipped_count || 0}</small>
                )}
                {job.status === "running" && (
                  <div className="bar">
                    <i
                      className="amber"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}
                {job.status === "waiting_confirm" && (
                  <div className="inline-task-actions">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate?.("download");
                      }}
                    >
                      打开待入库
                    </button>
                  </div>
                )}
                {["running", "queued"].includes(job.status) && (
                  <div className="inline-task-actions">
                    <button onClick={(event) => { event.stopPropagation(); control(job, "cancel"); }}>
                      取消任务
                    </button>
                  </div>
                )}
                {["failed", "cancelled"].includes(job.status) && (
                  <div className="inline-task-actions">
                    <button className="confirm" onClick={(event) => { event.stopPropagation(); control(job, "retry"); }}>
                      重试
                    </button>
                  </div>
                )}
              </div>
              <em className={`status-pill ${job.status}`}>
                {label(job.status)}
              </em>
              <time>{timeAgo(job.created_at)}</time>
            </div>
          ))
        ) : (
          <Empty
            icon={Activity}
            title="这一类暂时没有任务"
            text="任务会按运行、确认、失败和历史自动归类。"
          />
        )}
      </section>
      {detail && (
        <div className="modal-wrap">
          <button className="modal-backdrop" onClick={() => setDetail(null)} />
          <section className="modal panel log-modal job-modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">任务详情</span>
                <h3>{detail.title}</h3>
              </div>
              <button className="icon-button" onClick={() => setDetail(null)} aria-label="关闭任务详情" title="关闭">
                <X />
              </button>
            </div>
            <dl className="task-detail-meta">
              <div>
                <dt>任务名称</dt>
                <dd>{detail.title}</dd>
              </div>
              <div>
                <dt>开始时间</dt>
                <dd>
                  {detail.created_at
                    ? new Date(detail.created_at).toLocaleString("zh-CN")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>当前进度</dt>
                <dd>{detail.progress || 0}%</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{label(detail.status)}</dd>
              </div>
              <div>
                <dt>执行范围</dt>
                <dd>{detail.payload?.scope || "全部"}{detail.payload?.scopeValue ? ` · ${detail.payload.scopeValue}` : ""}</dd>
              </div>
              <div>
                <dt>结果</dt>
                <dd>成功 {detail.success_count || 0} · 失败 {detail.failed_count || 0} · 跳过 {detail.skipped_count || 0}</dd>
              </div>
              <div>
                <dt>结束时间</dt>
                <dd>{detail.finished_at ? new Date(detail.finished_at).toLocaleString("zh-CN") : "—"}</dd>
              </div>
            </dl>
            {detail.error_message && (
              <div className="inline-error">
                <CircleAlert />
                {detail.error_code}: {detail.error_message}
              </div>
            )}
            {detail.status === "waiting_confirm" && detail.result?.preview && (
              <div className="ingest-preview">
                <div>
                  <small>临时文件</small>
                  <code>{detail.result.preview.incomingPath}</code>
                </div>
                <ChevronRight />
                <div>
                  <small>目标路径</small>
                  <code>{detail.result.preview.targetPath}</code>
                </div>
                <dl>
                  <div>
                    <dt>歌曲</dt>
                    <dd>{detail.result.preview.title}</dd>
                  </div>
                  <div>
                    <dt>歌手 / 专辑</dt>
                    <dd>
                      {detail.result.preview.artist} ·{" "}
                      {detail.result.preview.album}
                    </dd>
                  </div>
                  <div>
                    <dt>音质</dt>
                    <dd>{detail.result.preview.quality}</dd>
                  </div>
                  <div>
                    <dt>冲突</dt>
                    <dd>
                      {detail.result.preview.conflictAdjusted
                        ? "已自动使用安全新文件名"
                        : "无"}
                    </dd>
                  </div>
                </dl>
                <div className="decision-actions">
                  <button className="primary" onClick={() => { setDetail(null); navigate?.("download"); }}>
                    <ArrowDownToLine />打开待入库批量处理
                  </button>
                </div>
              </div>
            )}
            <div className="decision-actions">
              {["running", "queued"].includes(detail.status) && (
                <button className="secondary" onClick={() => control(detail, "cancel")}><X />取消任务</button>
              )}
              {["failed", "cancelled"].includes(detail.status) && (
                <button className="primary" onClick={() => control(detail, "retry")}><RefreshCw />重试任务</button>
              )}
            </div>
            <div className="log-list">
              {detail.logs?.map((item) => (
                <div className={item.level} key={item.id}>
                  <time>
                    {new Date(item.created_at).toLocaleString("zh-CN")}
                  </time>
                  <p>{item.message}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
