from __future__ import annotations

import json
import queue
import threading
import traceback
import uuid

from .db import now, row, rows, transaction
from .downloader import cancel_download, confirm_download, download_song
from .local_library import local_library, organizer
from .lyrics import fill_missing_lyrics
from .plex import plex
from .scraper import fill_album_covers, scrape_artists


class JobCancelled(RuntimeError):
    pass


class JobManager:
    def __init__(self):
        self.queue = queue.Queue()
        self.thread = threading.Thread(target=self._worker, name="songlib-jobs", daemon=True)
        self.started = False
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
        }

    def start(self):
        if not self.started:
            self.started = True
            self.thread.start()

    def create(self, kind: str, title: str, payload: dict):
        if kind not in self.handlers:
            raise ValueError("未知任务类型")
        with transaction() as conn:
            cursor = conn.execute(
                "INSERT INTO jobs(kind,title,status,payload,input,source_id,created_at) VALUES(?,?,?,?,?,?,?)",
                (kind, title, "queued", json.dumps(payload, ensure_ascii=False), json.dumps(payload, ensure_ascii=False),
                 str(payload.get("sourceId")) if payload.get("sourceId") else None, now()),
            )
            job_id = cursor.lastrowid
        add_job_log(job_id, "info", "任务已加入安全串行队列。")
        self.queue.put(job_id)
        return get_job(job_id)

    def _worker(self):
        while True:
            job_id = self.queue.get()
            try:
                self._run(job_id)
            finally:
                self.queue.task_done()

    def _run(self, job_id: int):
        job = get_job(job_id)
        if not job or job.get("status") == "cancelled" or job.get("cancel_requested"):
            return
        payload = job["payload"] if isinstance(job.get("payload"), dict) else json.loads(job["payload"] or "{}")
        with transaction() as conn:
            conn.execute("UPDATE jobs SET status='running',started_at=?,message='任务启动' WHERE id=?", (now(), job_id))
        add_job_log(job_id, "info", "任务开始执行。")

        last_log = {"progress": -10, "message": ""}

        def progress(value, message="", current=None, total=None):
            state = row("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,))
            if state and state.get("cancel_requested"):
                raise JobCancelled("任务已由用户取消")
            fields = ["progress=?", "message=?"]
            values = [max(0, min(99, int(value))), message]
            if total is not None:
                fields.append("total=?")
                values.append(int(total))
            values.append(job_id)
            with transaction() as conn:
                conn.execute(f"UPDATE jobs SET {','.join(fields)} WHERE id=?", tuple(values))
            if message and (message != last_log["message"] or int(value) - last_log["progress"] >= 10):
                add_job_log(job_id, "info", message, {"progress": int(value)})
                last_log.update(progress=int(value), message=message)

        try:
            result = self.handlers[job["kind"]](payload, progress)
            waiting = isinstance(result, dict) and result.get("waitingConfirm")
            success, failed, skipped = _result_counts(result)
            with transaction() as conn:
                conn.execute(
                    "UPDATE jobs SET status=?,progress=?,message=?,result=?,output=?,success_count=?,failed_count=?,skipped_count=?,finished_at=? WHERE id=?",
                    (("waiting_confirm" if waiting else "completed"), (95 if waiting else 100),
                     ("等待确认入库" if waiting else "完成"), json.dumps(result, ensure_ascii=False),
                     json.dumps(result, ensure_ascii=False), success, failed, skipped, (None if waiting else now()), job_id),
                )
            warning = (result or {}).get("plexWarning") if isinstance(result, dict) else ""
            message = "下载完成，等待用户确认入库预览。" if waiting else (warning or "任务全部步骤执行完成。")
            add_job_log(job_id, "info" if waiting else ("warning" if warning else "success"), message)
        except JobCancelled as exc:
            with transaction() as conn:
                conn.execute("UPDATE jobs SET status='cancelled',message=?,finished_at=? WHERE id=?", (str(exc), now(), job_id))
            add_job_log(job_id, "warning", str(exc))
        except Exception as exc:
            result = {"error": str(exc), "trace": traceback.format_exc(limit=8)}
            error_code = getattr(exc, "code", "JOB_EXECUTION_FAILED")
            with transaction() as conn:
                conn.execute(
                    """UPDATE jobs SET status='failed',message=?,result=?,output=?,failed_count=1,error_code=?,error_message=?,finished_at=? WHERE id=?""",
                    (str(exc)[:500], json.dumps(result, ensure_ascii=False), json.dumps(result, ensure_ascii=False),
                     error_code, str(exc)[:500], now(), job_id),
                )
            add_job_log(job_id, "error", str(exc)[:500], {"error_code": error_code})

    @staticmethod
    def _plex_scan(payload, progress):
        progress(20, "正在请求 Plex 扫描")
        plex.scan()
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
        if job["status"] not in ("queued", "running"):
            raise ValueError("只有排队或执行中的任务可以取消")
        with transaction() as conn:
            if job["status"] == "queued":
                conn.execute("UPDATE jobs SET status='cancelled',message='任务已取消',cancel_requested=1,finished_at=? WHERE id=?", (now(), job_id))
            else:
                conn.execute("UPDATE jobs SET cancel_requested=1,message='正在安全取消' WHERE id=?", (job_id,))
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
    for field in ("payload", "result"):
        try:
            item[field] = json.loads(item[field] or "{}")
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
            (uuid.uuid4().hex, job_id, level, message,
             json.dumps(detail, ensure_ascii=False) if detail is not None else None, now()),
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
