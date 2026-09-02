import { Check, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import { timeAgo } from "../lib/format";

function JobRow({ job }) {
  const state = job.status;
  return (
    <div className="job-row">
      <div className={`job-state ${state}`}>
        {state === "running" ? (
          <LoaderCircle className="spin" />
        ) : state === "completed" ? (
          <Check />
        ) : state === "failed" ? (
          <CircleAlert />
        ) : (
          <Clock3 />
        )}
      </div>
      <div className="job-info">
        <div>
          <strong>{job.title}</strong>
          <span>{timeAgo(job.created_at)}</span>
        </div>
        <p>{job.message || (state === "queued" ? "等待执行" : "任务完成")}</p>
        {state === "running" && (
          <div className="bar">
            <i className="amber" style={{ width: `${job.progress}%` }} />
          </div>
        )}
      </div>
      <em>
        {state === "running"
          ? `${job.progress}%`
          : state === "completed"
            ? "完成"
            : state === "failed"
              ? "失败"
              : "排队"}
      </em>
    </div>
  );
}
