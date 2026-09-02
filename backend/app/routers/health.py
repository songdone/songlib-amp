"""健康探针。

三个探针各有用途，不要合并：
  /api/health        人看的完整体检，含 Plex 与 Worker 状态
  /api/health/live   容器存活探针，只要进程在就返回 200
  /api/health/ready  就绪探针，数据库或数据目录不可用时返回 503
"""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import get_kv, row
from ..jobs import manager
from ..plex import plex

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health():
    checks = _health_checks()
    return {
        "status": "ok" if checks["database"]["ok"] and checks["storage"]["ok"] else "error",
        "version": settings.app_version,
        "checks": checks,
    }


@router.get("/live")
def health_live():
    return {"status": "ok", "version": settings.app_version}


@router.get("/ready")
def health_ready():
    checks = _health_checks()
    ready = checks["database"]["ok"] and checks["storage"]["ok"]
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "version": settings.app_version, "checks": checks},
    )


def _health_checks():
    database = {"ok": False, "message": "数据库不可用"}
    storage = {"ok": False, "message": "数据目录不可写"}
    try:
        database = {"ok": bool(row("SELECT 1 AS value")), "message": "数据库可用"}
    except Exception:
        pass
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        storage = {"ok": settings.data_dir.exists() and os.access(settings.data_dir, os.W_OK), "message": "数据目录可用"}
    except Exception:
        pass
    plex_config = plex.saved_settings()
    if not plex_config["enabled"]:
        plex_status = {"ok": True, "status": "disabled", "message": "Plex 已停用"}
    elif not plex_config["serverUrl"]:
        plex_status = {"ok": True, "status": "not_configured", "message": "尚未连接 Plex"}
    else:
        try:
            plex.xml("/identity")
            plex_status = {"ok": True, "status": "connected", "message": "Plex 已连接"}
        except Exception:
            plex_status = {"ok": False, "status": "unavailable", "message": "Plex 暂时不可用"}
    heartbeat = get_kv("worker_heartbeat", {}) or {}
    heartbeat_at = heartbeat.get("at")
    heartbeat_fresh = False
    if heartbeat_at:
        try:
            heartbeat_fresh = (datetime.now().astimezone() - datetime.fromisoformat(heartbeat_at)).total_seconds() < max(15, settings.worker_poll_seconds * 4)
        except (TypeError, ValueError):
            pass
    embedded_running = settings.worker_mode == "embedded" and manager.started
    worker_ok = embedded_running or heartbeat_fresh
    return {
        "database": database,
        "storage": storage,
        "worker": {
            "ok": worker_ok,
            "mode": settings.worker_mode,
            "message": "后台任务服务在线" if worker_ok else "后台任务服务尚未上报状态",
            "lastSeenAt": heartbeat_at,
        },
        "plex": plex_status,
    }


