from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone

from .config import settings
from .db import now, row, rows, set_kv, transaction
from .downloader import cancel_download, confirm_download, download_song
from .download_inbox import download_inbox
from .local_library import local_library, organizer
from .lyrics import fill_missing_lyrics
from .plex import plex
from .scraper import fill_album_covers, scrape_artists


class JobCancelled(RuntimeError):
    pass


class JobManager:
    def __init__(self):
        self.worker_id = f"worker-{uuid.uuid4().hex[:12]}"
        self.thread: threading.Thread | None = None
        self.started = False
        self.stop_event = threading.Event()
        self.handlers = {
            "scrape_artists": scrape_artists,
            "scrape_plex_metadata": self._scrape_plex_metadata,
            "fill_album_covers": fill_album_covers,
            "fill_lyrics": fill_missing_lyrics,
            "fill_assets": self._fill_assets,
            "fill_local_tags": local_library.fill_missing_tags,
            "plex_scan": self._plex_scan,
            "download": download_song,
            "organize_confirm": confirm_download,
            "organize_cancel": cancel_download,
            "local_scan": local_library.scan,
            "plex_sync": local_library.sync_plex,
            "local_organize": self._local_organize,
            "download_inbox_ingest": download_inbox.ingest,
        }

    def start(self):
        if self.started:
            return
        self.started = True
        self.stop_event.clear()
        self.thread = threading.Thread(target=self.run_forever, name="songlib-worker", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=max(3, settings.worker_poll_seconds + 1))
        self.started = False

    def run_forever(self):
        while not self.stop_event.is_set():
            set_kv("worker_heartbeat", {"workerId": self.worker_id, "at": now()})
            job_id = self._claim_next()
            if job_id is None:
                self.stop_event.wait(settings.worker_poll_seconds)
                continue
            self._run(job_id)

    def create(self, kind: str, title: str, payload: dict, idempotency_key: str | None = None):
        if kind not in self.handlers:
            raise ValueError("未知任务类型")
        clean_key = (idempotency_key or payload.get("idempotencyKey") or "").strip()[:160] or None
        if clean_key:
            existing = row("SELECT id FROM jobs WHERE idempotency_key=?", (clean_key,))
            if existing:
                return get_job(existing["id"])
        stamp = now()
        try:
            with transaction() as conn:
                cursor = conn.execute(
                    """INSERT INTO jobs(
                         kind,title,status,payload,input,source_id,idempotency_key,max_attempts,
                         next_run_at,created_at,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        kind,
                        title,
                        "queued",
                        json.dumps(payload, ensure_ascii=False),
                        json.dumps(payload, ensure_ascii=False),
                        str(payload.get("sourceId")) if payload.get("sourceId") else None,
                        clean_key,
                        settings.worker_max_attempts,
                        stamp,
                        stamp,
                        stamp,
                    ),
                )
                job_id = cursor.lastrowid
        except Exception as exc:
            if clean_key and "UNIQUE" in str(exc).upper():
                existing = row("SELECT id FROM jobs WHERE idempotency_key=?", (clean_key,))
                if existing:
                    return get_job(existing["id"])
            raise
        add_job_log(job_id, "info", "任务已进入持久队列，可在服务重启后继续。")
        return get_job(job_id)

    def _claim_next(self) -> int | None:
        stamp = now()
        expires = (datetime.now(timezone.utc) + timedelta(seconds=settings.worker_lease_seconds)).isoformat()
        with transaction() as conn:
            conn.execute("BEGIN IMMEDIATE")
            item = conn.execute(
                """SELECT id FROM jobs
                   WHERE cancel_requested=0
                     AND (
                       (status IN ('queued','retrying') AND (next_run_at IS NULL OR next_run_at<=?))
                       OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?))
                     )
                   ORDER BY created_at,id
                   LIMIT 1""",
                (stamp, stamp),
            ).fetchone()
            if not item:
                return None
            cursor = conn.execute(
                """UPDATE jobs
                   SET status='running', started_at=COALESCE(started_at,?), message='任务启动',
                       lease_owner=?, lease_expires_at=?, attempt=attempt+1, updated_at=?
                   WHERE id=? AND cancel_requested=0
                     AND (
                       status IN ('queued','retrying')
                       OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?))
                     )""",
                (stamp, self.worker_id, expires, stamp, item["id"], stamp),
            )
            return int(item["id"]) if cursor.rowcount == 1 else None

    def _run(self, job_id: int):
        job = get_job(job_id)
        if not job or job.get("status") == "cancelled" or job.get("cancel_requested"):
            return
        payload = job["payload"] if isinstance(job.get("payload"), dict) else json.loads(job["payload"] or "{}")
        add_job_log(job_id, "info", f"任务由 {self.worker_id} 开始执行。")
        last_log = {"progress": -10, "message": ""}

        def progress(value, message="", current=None, total=None):
            state = row("SELECT cancel_requested,lease_owner FROM jobs WHERE id=?", (job_id,))
            if state and state.get("cancel_requested"):
                raise JobCancelled("任务已由用户取消")
            if not state or state.get("lease_owner") != self.worker_id:
                raise JobCancelled("任务租约已失效，停止本次执行")
            fields = ["progress=?", "message=?", "checkpoint=?", "lease_expires_at=?", "updated_at=?"]
            checkpoint = {
                "progress": max(0, min(99, int(value))),
                "message": str(message or "")[:500],
                "current": current,
                "total": total,
            }
            values = [
                checkpoint["progress"],
                checkpoint["message"],
                json.dumps(checkpoint, ensure_ascii=False),
                (datetime.now(timezone.utc) + timedelta(seconds=settings.worker_lease_seconds)).isoformat(),
                now(),
            ]
            if total is not None:
                fields.append("total=?")
                values.append(int(total))
            values.append(job_id)
            with transaction() as conn:
                conn.execute(
                    f"UPDATE jobs SET {','.join(fields)} WHERE id=? AND lease_owner=?",
                    tuple(values[:-1] + [job_id, self.worker_id]),
                )
            if message and (message != last_log["message"] or int(value) - last_log["progress"] >= 10):
                add_job_log(job_id, "info", message, {"progress": int(value)})
                last_log.update(progress=int(value), message=message)

        try:
            result = self.handlers[job["kind"]](payload, progress)
            waiting = isinstance(result, dict) and result.get("waitingConfirm")
            success, failed, skipped = _result_counts(result)
            with transaction() as conn:
                conn.execute(
                    """UPDATE jobs SET status=?,progress=?,message=?,result=?,output=?,success_count=?,
                       failed_count=?,skipped_count=?,finished_at=?,lease_owner=NULL,lease_expires_at=NULL,
                       checkpoint='{}',updated_at=? WHERE id=? AND lease_owner=?""",
                    (
                        ("waiting_confirm" if waiting else "completed"),
                        (95 if waiting else 100),
                        ("等待确认入库" if waiting else "完成"),
                        json.dumps(result, ensure_ascii=False),
                        json.dumps(result, ensure_ascii=False),
                        success,
                        failed,
                        skipped,
                        (None if waiting else now()),
                        now(),
                        job_id,
                        self.worker_id,
                    ),
                )
            warning = (result or {}).get("plexWarning") if isinstance(result, dict) else ""
            message = "下载完成，等待用户确认入库预览。" if waiting else (warning or "任务全部步骤执行完成。")
            add_job_log(job_id, "info" if waiting else ("warning" if warning else "success"), message)
        except JobCancelled as exc:
            with transaction() as conn:
                conn.execute(
                    """UPDATE jobs SET status='cancelled',message=?,finished_at=?,lease_owner=NULL,
                       lease_expires_at=NULL,updated_at=? WHERE id=?""",
                    (str(exc), now(), now(), job_id),
                )
            add_job_log(job_id, "warning", str(exc))
        except Exception as exc:
            self._handle_failure(job_id, exc)

    def _handle_failure(self, job_id: int, exc: Exception):
        current = row("SELECT attempt,max_attempts FROM jobs WHERE id=?", (job_id,)) or {}
        attempt = int(current.get("attempt") or 1)
        max_attempts = int(current.get("max_attempts") or settings.worker_max_attempts)
        retrying = attempt < max_attempts
        trace = traceback.format_exc(limit=8)
        result = {"error": str(exc), "trace": trace}
        error_code = getattr(exc, "code", "JOB_EXECUTION_FAILED")
        next_run = (datetime.now(timezone.utc) + timedelta(seconds=min(300, 5 * (2 ** (attempt - 1))))).isoformat()
        with transaction() as conn:
            conn.execute(
                """UPDATE jobs SET status=?,message=?,result=?,output=?,failed_count=1,error_code=?,
                   error_message=?,finished_at=?,next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
                   WHERE id=?""",
                (
                    "retrying" if retrying else "failed",
                    (f"执行失败，将进行第 {attempt + 1} 次尝试" if retrying else str(exc)[:500]),
                    json.dumps(result, ensure_ascii=False),
                    json.dumps(result, ensure_ascii=False),
                    error_code,
                    str(exc)[:500],
                    None if retrying else now(),
                    next_run if retrying else None,
                    now(),
                    job_id,
                ),
            )
        add_job_log(
            job_id,
            "warning" if retrying else "error",
            (f"执行失败，已安排自动重试（{attempt}/{max_attempts}）" if retrying else str(exc)[:500]),
            {"error_code": error_code},
        )

    @staticmethod
    def _plex_scan(payload, progress):
        progress(20, "正在请求 Plex 扫描")
        plex.scan()
        # 目录有 60 秒缓存，扫完主动清掉，别让新入库的歌等一分钟才出现。
        plex.invalidate_catalog()
        return {"triggered": True}

    @staticmethod
    def _combine(first: dict, second: dict) -> dict:
        return {
            "success": int(first.get("success") or 0) + int(second.get("success") or 0),
            "failed": int(first.get("failed") or 0) + int(second.get("failed") or 0),
            "skipped": int(first.get("skipped") or 0) + int(second.get("skipped") or 0),
            "steps": [first, second],
        }

    def _scrape_plex_metadata(self, payload, progress):
        first = scrape_artists(payload, lambda value, message="", current=None, total=None: progress(int(value * .52), message, current, total))
        second = fill_album_covers(payload, lambda value, message="", current=None, total=None: progress(52 + int(value * .45), message, current, total))
        return self._combine(first, second)

    def _fill_assets(self, payload, progress):
        first = fill_album_covers(payload, lambda value, message="", current=None, total=None: progress(int(value * .48), message, current, total))
        second = fill_missing_lyrics(payload, lambda value, message="", current=None, total=None: progress(48 + int(value * .52), message, current, total))
        return self._combine(first, second)

    @staticmethod
    def _local_organize(payload, progress):
        previews = [item.get("execution") for item in (payload.get("items") or []) if item.get("action") != "skip" and item.get("execution")]
        result = organizer.apply(previews or payload.get("previews") or [], progress)
        result.update(success=len(result.get("moved") or []), failed=0, skipped=0)
        return result

    def cancel(self, job_id: int):
        job = get_job(job_id)
        if not job:
            raise KeyError("任务不存在")
        if job["status"] not in ("queued", "retrying", "running"):
            raise ValueError("只有排队、重试或执行中的任务可以取消")
        with transaction() as conn:
            if job["status"] in ("queued", "retrying"):
                conn.execute(
                    "UPDATE jobs SET status='cancelled',message='任务已取消',cancel_requested=1,finished_at=?,updated_at=? WHERE id=?",
                    (now(), now(), job_id),
                )
            else:
                conn.execute(
                    "UPDATE jobs SET cancel_requested=1,message='正在安全取消',updated_at=? WHERE id=?",
                    (now(), job_id),
                )
        add_job_log(job_id, "warning", "用户请求取消任务。")
        return get_job(job_id)

    def retry(self, job_id: int):
        job = get_job(job_id)
        if not job:
            raise KeyError("任务不存在")
        if job["status"] not in ("failed", "cancelled"):
            raise ValueError("只有失败或已取消任务可以重试")
        return self.create(job["kind"], f"重试 · {job['title']}", job.get("payload") or {})


def _decode(item):
    if not item:
        return None
    for field in ("payload", "result", "checkpoint"):
        try:
            item[field] = json.loads(item.get(field) or "{}")
        except json.JSONDecodeError:
            item[field] = {}
    return item


def _result_counts(result):
    if not isinstance(result, dict):
        return 0, 0, 0
    success = int(result.get("success") or result.get("written") or result.get("filled") or result.get("scanned") or 0)
    failed = int(result.get("failed") or len(result.get("errors") or []))
    skipped = int(result.get("skipped") or result.get("notFound") or 0)
    return success, failed, skipped


def add_job_log(job_id: int, level: str, message: str, detail=None):
    with transaction() as conn:
        conn.execute(
            "INSERT INTO job_logs(id,job_id,level,message,detail,created_at) VALUES(?,?,?,?,?,?)",
            (
                uuid.uuid4().hex,
                job_id,
                level,
                message,
                json.dumps(detail, ensure_ascii=False) if detail is not None else None,
                now(),
            ),
        )


def list_job_logs(job_id: int, limit=200):
    result = rows("SELECT * FROM job_logs WHERE job_id=? ORDER BY created_at ASC LIMIT ?", (job_id, limit))
    for item in result:
        try:
            item["detail"] = json.loads(item["detail"]) if item.get("detail") else None
        except json.JSONDecodeError:
            pass
    return result


def get_job(job_id: int):
    item = _decode(row("SELECT * FROM jobs WHERE id=?", (job_id,)))
    if item:
        item["logs"] = list_job_logs(job_id)
    return item


def list_jobs(limit=50):
    return [_decode(item) for item in rows("SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,))]


manager = JobManager()
