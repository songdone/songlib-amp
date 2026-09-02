/**
 * 任务。
 *
 * 任务按处理方式分四类，顺序就是用户该关注的顺序：
 * 正在跑的、等我拍板的、需要重试的、已经完事的。
 * 四个磁贴同时充当筛选器，id 与 groups 的键一致。
 *
 * 重构掉的两个真实缺陷：
 *
 * 1. 整行原来是 `<div onClick>`，键盘根本到不了；行内又嵌着"取消""重试"
 *    几个 <button>，所以每个都得写 stopPropagation 才不会连带打开详情。
 *    嵌套交互元素本身也是无效 HTML。
 *    现在标题自己是按钮，操作按钮是它的兄弟节点，行本身不可点 ——
 *    Tab 顺序自然，也不需要 stopPropagation。
 *
 * 2. confirm() 原生弹窗换成 Modal。取消一个正在跑的任务是有代价的操作，
 *    弹窗里要说清代价，而不只是问一句"确定吗"。
 */

import {
  Activity,
  ArrowDownToLine,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  WandSparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import {
  EmptyState,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";

const TASK_FILTERS = [
  { id: "running", icon: LoaderCircle, label: "正在执行", tone: "accent" },
  { id: "confirm", icon: WandSparkles, label: "等我确认", tone: "warning" },
  { id: "failed", icon: CircleAlert, label: "需要重试", tone: "danger" },
  { id: "history", icon: Check, label: "已完成", tone: "success" },
];

/** 状态 → 中文名 + 徽章色。数据库存的是英文枚举，不能直接摆到界面上。 */
const STATUS = {
  running: { label: "执行中", tone: "accent", icon: LoaderCircle },
  queued: { label: "排队中", tone: "neutral", icon: Clock3 },
  waiting_confirm: { label: "等你确认", tone: "warning", icon: WandSparkles },
  completed: { label: "已完成", tone: "success", icon: Check },
  failed: { label: "失败", tone: "danger", icon: CircleAlert },
  cancelled: { label: "已取消", tone: "neutral", icon: X },
};

const statusOf = (status) => STATUS[status] || STATUS.queued;

const timeText = (value) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";

export function Tasks({ jobs, refresh, navigate }) {
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("running");
  const [error, setError] = useState("");
  /** 待确认的控制操作。`{ job, action }`，action 是 cancel 或 retry。 */
  const [pendingControl, setPendingControl] = useState(null);

  const inspect = async (id) => {
    try {
      setDetail(await api(`/api/jobs/${id}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  const runControl = async () => {
    const request = pendingControl;
    setPendingControl(null);
    if (!request) return;
    try {
      await api(`/api/jobs/${request.job.id}/${request.action}`, {
        method: "POST",
      });
      setDetail(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const groups = {
    running: jobs.filter((job) => ["running", "queued"].includes(job.status)),
    confirm: jobs.filter((job) => job.status === "waiting_confirm"),
    failed: jobs.filter((job) => job.status === "failed"),
    history: jobs.filter(
      (job) =>
        !["running", "queued", "waiting_confirm", "failed"].includes(job.status),
    ),
  };
  const visible = groups[filter] || jobs;

  const cancellable = (status) => ["running", "queued"].includes(status);
  const retryable = (status) => ["failed", "cancelled"].includes(status);

  return (
    <Page className="tasks">
      {/* 顶栏已经写了"任务"，这里不重复页名。 */}
      <SectionHeader
        title="后台在跑什么"
        note="点上面的数字只看那一类"
        actions={
          <Button size="sm" icon={RefreshCw} onClick={refresh}>
            刷新
          </Button>
        }
      />

      {error && (
        <Notice tone="danger" icon={CircleAlert}>
          {error}
        </Notice>
      )}

      {/* 磁贴的选中态用 aria-pressed 表达，读屏能听出正在看哪一类。 */}
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

      <Section>
        {visible.length ? (
          <div className="task-list">
            {visible.map((job) => {
              const status = statusOf(job.status);
              const StatusIcon = status.icon;
              return (
                <div className="task-row" key={job.id}>
                  <span
                    className={`task-row__icon task-row__icon--${status.tone}`}
                    aria-hidden="true"
                  >
                    <StatusIcon
                      className={job.status === "running" ? "spin" : undefined}
                    />
                  </span>

                  <div className="task-row__text">
                    {/* 标题本身是按钮 —— 整行可点会把里面的操作按钮变成嵌套交互。 */}
                    <button
                      type="button"
                      className="task-row__title"
                      onClick={() => inspect(job.id)}
                    >
                      {job.title}
                    </button>
                    <small>
                      {job.error_message ||
                        job.message ||
                        `${timeAgo(job.created_at)}发起`}
                    </small>
                    {!["queued", "running", "waiting_confirm"].includes(
                      job.status,
                    ) && (
                      <small>
                        成功 {job.success_count || 0} · 失败{" "}
                        {job.failed_count || 0} · 跳过 {job.skipped_count || 0}
                      </small>
                    )}
                    {job.status === "running" && (
                      <div
                        className="task-row__bar"
                        role="progressbar"
                        aria-valuenow={job.progress || 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${job.title} 的进度`}
                      >
                        <i style={{ width: `${job.progress || 0}%` }} />
                      </div>
                    )}
                  </div>

                  <Badge tone={status.tone}>{status.label}</Badge>

                  <div className="task-row__actions">
                    {job.status === "waiting_confirm" && (
                      <Button size="sm" onClick={() => navigate?.("download")}>
                        去确认
                      </Button>
                    )}
                    {cancellable(job.status) && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setPendingControl({ job, action: "cancel" })
                        }
                      >
                        取消
                      </Button>
                    )}
                    {retryable(job.status) && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setPendingControl({ job, action: "retry" })
                        }
                      >
                        重试
                      </Button>
                    )}
                  </div>

                  <time className="task-row__time">
                    {timeAgo(job.created_at)}
                  </time>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title={
              filter === "running" ? "现在没有任务在跑" : "这一类没有任务"
            }
            text="在跑的、等你确认的、失败的，点上面的数字分开看。"
          />
        )}
      </Section>

      {/* --- 任务详情 --- */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title || "任务详情"}
        description={detail ? `${statusOf(detail.status).label} · ${timeAgo(detail.created_at)}发起` : ""}
        size="lg"
        actions={
          detail && (
            <ButtonGroup align="end">
              {cancellable(detail.status) && (
                <Button
                  icon={X}
                  onClick={() =>
                    setPendingControl({ job: detail, action: "cancel" })
                  }
                >
                  取消任务
                </Button>
              )}
              {retryable(detail.status) && (
                <Button
                  variant="primary"
                  icon={RefreshCw}
                  onClick={() =>
                    setPendingControl({ job: detail, action: "retry" })
                  }
                >
                  再跑一次
                </Button>
              )}
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </ButtonGroup>
          )
        }
      >
        {detail && (
          <>
            <dl className="task-meta">
              <div>
                <dt>进度</dt>
                <dd>{detail.progress || 0}%</dd>
              </div>
              <div>
                <dt>范围</dt>
                <dd>
                  {detail.payload?.scope || "全部"}
                  {detail.payload?.scopeValue
                    ? ` · ${detail.payload.scopeValue}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>结果</dt>
                <dd>
                  成功 {detail.success_count || 0} · 失败{" "}
                  {detail.failed_count || 0} · 跳过 {detail.skipped_count || 0}
                </dd>
              </div>
              <div>
                <dt>开始</dt>
                <dd>{timeText(detail.created_at)}</dd>
              </div>
              <div>
                <dt>结束</dt>
                <dd>{timeText(detail.finished_at)}</dd>
              </div>
            </dl>

            {detail.error_message && (
              <Notice tone="danger" icon={CircleAlert}>
                {detail.error_code ? `${detail.error_code}：` : ""}
                {detail.error_message}
              </Notice>
            )}

            {detail.status === "waiting_confirm" && detail.result?.preview && (
              <div className="task-preview">
                <p className="task-preview__lead">
                  这首已经下好了，等你确认往哪儿放：
                </p>
                <dl>
                  <div>
                    <dt>歌曲</dt>
                    <dd>
                      {detail.result.preview.title} ·{" "}
                      {detail.result.preview.artist} ·{" "}
                      {detail.result.preview.album}
                    </dd>
                  </div>
                  <div>
                    <dt>音质</dt>
                    <dd>{detail.result.preview.quality}</dd>
                  </div>
                  <div>
                    <dt>现在在</dt>
                    <dd>
                      <code>{detail.result.preview.incomingPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>要放到</dt>
                    <dd>
                      <code>{detail.result.preview.targetPath}</code>
                    </dd>
                  </div>
                  {detail.result.preview.conflictAdjusted && (
                    <div>
                      <dt>重名</dt>
                      <dd>目标位置已有同名文件，已经换了个安全的名字</dd>
                    </div>
                  )}
                </dl>
                <Button
                  variant="primary"
                  icon={ArrowDownToLine}
                  onClick={() => {
                    setDetail(null);
                    navigate?.("download");
                  }}
                >
                  去待入库处理
                </Button>
              </div>
            )}

            {detail.logs?.length > 0 && (
              <div className="task-logs">
                {detail.logs.map((item) => (
                  <div className={`task-logs__line ${item.level}`} key={item.id}>
                    <time>{timeText(item.created_at)}</time>
                    <p>{item.message}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* 取消一个正在跑的任务是有代价的，弹窗要说清代价。 */}
      <Modal
        open={Boolean(pendingControl)}
        onClose={() => setPendingControl(null)}
        title={
          pendingControl?.action === "retry"
            ? "再跑一次这个任务？"
            : "取消这个任务？"
        }
        description={pendingControl?.job?.title}
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setPendingControl(null)}>先不动</Button>
            <Button variant="primary" onClick={runControl}>
              {pendingControl?.action === "retry" ? "重新执行" : "取消任务"}
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          {pendingControl?.action === "retry"
            ? "会从头再走一遍。上次已经写进去的部分不会重复写。"
            : "已经处理完的那部分不会退回去，剩下的停下不做。取消后可以再重试。"}
        </p>
      </Modal>
    </Page>
  );
}
