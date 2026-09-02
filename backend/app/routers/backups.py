"""数据库备份的创建、下载与恢复。

恢复前会对备份文件做 PRAGMA integrity_check，不通过就拒绝，
避免用一个损坏的备份覆盖正在用的库。
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .. import auth
from ..config import settings
from ..db import now

router = APIRouter(prefix="/api/backups", tags=["backups"])


def _backup_dir() -> Path:
    directory = settings.data_dir / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _backup_path(name: str) -> Path:
    safe = Path(name).name
    if safe != name or not re.fullmatch(r"songlib-\d{8}-\d{6}\.db", safe):
        raise HTTPException(status_code=400, detail="备份文件名无效")
    return _backup_dir() / safe


@router.get("", dependencies=[Depends(auth.current_user)])
def list_backups():
    items = []
    for path in sorted(_backup_dir().glob("songlib-*.db"), reverse=True):
        stat = path.stat()
        items.append({"name": path.name, "size": stat.st_size, "createdAt": datetime.fromtimestamp(stat.st_mtime).isoformat()})
    return {"items": items}


@router.post("", dependencies=[Depends(auth.current_user)])
def create_backup():
    if not settings.db_path.exists():
        raise HTTPException(status_code=404, detail="当前数据库不存在")
    name = datetime.now().strftime("songlib-%Y%m%d-%H%M%S.db")
    target = _backup_dir() / name
    source = sqlite3.connect(settings.db_path)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    target.chmod(0o600)
    return {"ok": True, "item": {"name": name, "size": target.stat().st_size, "createdAt": datetime.now().isoformat()}}


@router.get("/{name}/download", dependencies=[Depends(auth.current_user)])
def download_backup(name: str):
    path = _backup_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="备份不存在")
    return FileResponse(path, filename=path.name, media_type="application/x-sqlite3")


@router.post("/{name}/restore", dependencies=[Depends(auth.current_user)])
def restore_backup(name: str):
    path = _backup_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="备份不存在")
    source = sqlite3.connect(path)
    destination = sqlite3.connect(settings.db_path)
    try:
        check = source.execute("PRAGMA integrity_check").fetchone()
        if not check or check[0] != "ok":
            raise HTTPException(status_code=409, detail="备份完整性检查未通过")
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return {"ok": True, "restored": name, "message": "备份已恢复，请重新登录以刷新会话。"}
