from __future__ import annotations

import mimetypes
import json
import os
import re
import shutil
import sqlite3
import secrets
import time
import uuid
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl

from . import auth
from . import audit
from .catalog import search as catalog_search
from .config import settings
from .db import get_kv, init_db, now, row, rows, set_kv
from .jobs import get_job, list_job_logs, list_jobs, manager
from .local_library import local_library, organizer
from .plex import dashboard_stats, local_artist_background_file, plex
from .scraper import build_diff_preview
from .security import SecurityMiddleware, client_key, issue_csrf, rate_limiter
from . import playlists as playlist_service
from . import recommendations as recommendation_service
from .unified_catalog import match_external_tracks, normalize as normalize_catalog_text, unified_tracks
from .sources import (
    SourceError, delete_source, get_source, import_code, import_file, import_url, list_sources,
    inspect_source, preflight_download, resolve_track, set_enabled, source_logs, test_resolve, test_search,
)
from mutagen import File as MutagenFile


class LoginBody(BaseModel):
    username: str = "admin"
    password: str


class SetupBody(BaseModel):
    username: str = Field(default="admin", min_length=2, max_length=40)
    displayName: str = Field(default="", max_length=80)
    password: str = Field(min_length=12, max_length=200)


class PlaylistBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    items: list[dict] = Field(default_factory=list, max_length=20_000)


class PlaylistPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    items: list[dict] | None = Field(default=None, max_length=20_000)


class M3UImportBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(max_length=2_100_000)
    pathMappings: list[dict] = Field(default_factory=list, max_length=100)


class ListeningEventBody(BaseModel):
    eventType: str
    fileId: str | None = None
    externalRef: str | None = None
    positionMs: int = Field(default=0, ge=0)
    durationMs: int = Field(default=0, ge=0)
    context: dict = Field(default_factory=dict)


class RecommendationRefreshBody(BaseModel):
    exploration: float = Field(default=0.35, ge=0, le=1)
    discoveries: list[dict] = Field(default_factory=list, max_length=500)


class ChangePasswordBody(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=10, max_length=200)


class UserCreateBody(BaseModel):
    username: str
    displayName: str = ""
    password: str = Field(min_length=10, max_length=200)
    role: str = "listener"
    permissions: list[str] = Field(default_factory=lambda: ["listen"])
    libraryScopes: list[str] = Field(default_factory=list)


class UserUpdateBody(BaseModel):
    username: str | None = None
    displayName: str | None = None
    enabled: bool | None = None
    permissions: list[str] | None = None
    libraryScopes: list[str] | None = None


class UserPasswordBody(BaseModel):
    password: str = Field(min_length=10, max_length=200)


class SourceBody(BaseModel):
    name: str = ""
    url: HttpUrl


class SourceImportUrlBody(BaseModel):
    name: str = ""
    url: str


class SourceImportCodeBody(BaseModel):
    name: str = ""
    code: str


class SourceSearchBody(BaseModel):
    keyword: str = Field(min_length=1, max_length=100)
    platform: Optional[str] = None


class SourceResolveBody(BaseModel):
    track: dict
    quality: str = "320k"


class JobBody(BaseModel):
    kind: str
    payload: dict = Field(default_factory=dict)


class DownloadBody(BaseModel):
    sourceId: str
    quality: str
    item: dict


class BatchDownloadDecisionBody(BaseModel):
    jobIds: list[int] = Field(default_factory=list)


class SourcePreviewBody(BaseModel):
    sourceId: str
    quality: str = "128k"
    item: dict


class SettingsPatchBody(BaseModel):
    values: dict = Field(default_factory=dict)


class PlexSettingsBody(BaseModel):
    enabled: bool = True
    name: str = Field(default="Plex", min_length=1, max_length=80)
    serverUrl: str
    externalUrl: str = ""
    token: str = ""
    selectedLibraryKeys: list[str] | str = "all"


class PlexTestBody(BaseModel):
    serverUrl: str | None = None
    token: str | None = None


class TagUpdateBody(BaseModel):
    changes: dict


class OrganizePreviewBody(BaseModel):
    fileIds: list[str]


class OrganizeApplyBody(BaseModel):
    previews: list[dict]


class ScrapePreviewBody(BaseModel):
    kind: str
    scope: str = "missing"
    scopeValue: str = Field(default="", max_length=300)
    mode: str = "missing"
    limit: int = Field(default=100, ge=1, le=500)


class ScrapeApplyBody(BaseModel):
    planId: str


class DiscoveryDownloadBody(BaseModel):
    sourceId: str
    quality: str = "320k"
    tracks: list[dict] = Field(default_factory=list, max_length=100)


@asynccontextmanager
async def lifespan(app: FastAPI):
    errors = settings.validate()
    if errors:
        raise RuntimeError("；".join(errors))
    init_db()
    auth.ensure_bootstrap_password()
    if settings.worker_mode == "embedded":
        manager.start()
    try:
        yield
    finally:
        if settings.worker_mode == "embedded":
            manager.stop()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.add_middleware(SecurityMiddleware)


@app.exception_handler(SourceError)
def source_error_handler(request: Request, exc: SourceError):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error_code": exc.code, "message": exc.message})


@app.get("/api/health")
def health():
    checks = _health_checks()
    return {
        "status": "ok" if checks["database"]["ok"] and checks["storage"]["ok"] else "error",
        "version": settings.app_version,
        "checks": checks,
    }


@app.get("/api/health/live")
def health_live():
    return {"status": "ok", "version": settings.app_version}


@app.get("/api/health/ready")
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


@app.get("/api/setup/status")
def setup_status():
    return {
        "required": auth.setup_required(),
        "version": settings.app_version,
        "checks": _health_checks(),
    }


@app.post("/api/setup/complete")
def complete_setup(body: SetupBody, request: Request, response: Response):
    rate_limiter.check(client_key(request, "setup"), limit=5, window_seconds=900)
    user = auth.complete_setup(body.username, body.password, body.displayName)
    auth.login(response, body.password, body.username)
    audit.record(user["id"], request.state.request_id, "setup.complete", "installation", None, "success")
    return {"ok": True, "user": user}


@app.get("/api/auth/status")
def auth_status(request: Request, response: Response):
    try:
        user = auth.current_user(request)
        authenticated = True
        if not request.cookies.get("songlib_csrf"):
            issue_csrf(response)
    except HTTPException:
        user = None
        authenticated = False
    return {"authenticated": authenticated, "setupRequired": auth.setup_required(), "user": user}


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    if auth.setup_required():
        raise HTTPException(status_code=409, detail="请先完成初始设置")
    key = client_key(request, "login")
    rate_limiter.check(key, limit=8, window_seconds=900)
    try:
        user = auth.login(response, body.password, body.username)
    except HTTPException:
        audit.record(None, request.state.request_id, "auth.login", "session", None, "denied", {"username": body.username})
        raise
    audit.record(user["id"], request.state.request_id, "auth.login", "session", None, "success")
    return {"ok": True, "user": user}


@app.post("/api/auth/logout")
def logout(response: Response):
    auth.logout(response)
    return {"ok": True}


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordBody, response: Response, user=Depends(auth.current_user)):
    auth.change_password(user, body.currentPassword, body.newPassword)
    auth.logout(response)
    return {"ok": True}


@app.get("/api/users", dependencies=[Depends(auth.current_user)])
def users():
    return {"items": auth.list_users()}


@app.post("/api/users", dependencies=[Depends(auth.current_user)])
def create_user(body: UserCreateBody):
    return auth.create_user(body.username, body.password, body.displayName, body.role, body.permissions, body.libraryScopes)


@app.patch("/api/users/{user_id}", dependencies=[Depends(auth.current_user)])
def update_user(user_id: str, body: UserUpdateBody):
    result = auth.update_user(user_id, username=body.username, display_name=body.displayName, enabled=body.enabled)
    if body.permissions is not None or body.libraryScopes is not None:
        result = auth.set_user_access(user_id, body.permissions or result.get("permissions") or [], body.libraryScopes or result.get("libraryScopes") or [])
    return result


@app.post("/api/users/{user_id}/password", dependencies=[Depends(auth.current_user)])
def reset_user_password(user_id: str, body: UserPasswordBody):
    auth.reset_password(user_id, body.password)
    return {"ok": True}


@app.delete("/api/users/{user_id}", dependencies=[Depends(auth.current_user)])
def delete_user(user_id: str):
    auth.delete_user(user_id)
    return {"ok": True}


@app.get("/api/dashboard", dependencies=[Depends(auth.current_user)])
def dashboard():
    try:
        result = dashboard_stats()
        local = local_library.stats()
        last_scan = row("SELECT MAX(last_scanned_at) AS value FROM files") or {}
        result.update({
            "localTracks": local.get("total", 0),
            "localLastScanAt": last_scan.get("value"),
            "plexLastSyncAt": plex.saved_settings().get("lastSyncAt"),
            "failedTasks": (row("SELECT COUNT(*) AS count FROM jobs WHERE status='failed'") or {}).get("count", 0),
            "waitingIngest": (row("SELECT COUNT(*) AS count FROM jobs WHERE status='waiting_confirm'") or {}).get("count", 0),
        })
        return result
    except Exception as exc:
        local = local_library.stats()
        return {
            "artists": 0,
            "albums": 0,
            "tracks": local.get("total", 0),
            "localTracks": local.get("total", 0),
            "artistPosters": 0,
            "artistBackgrounds": 0,
            "albumCovers": 0,
            "localLyrics": max(0, local.get("total", 0) - local.get("missing_lyrics", 0)),
            "missingLyrics": local.get("missing_lyrics", 0),
            "heroImages": [],
            "plexAvailable": False,
            "warning": f"Plex 暂不可用：{exc}",
        }


CURATED_PLAYLIST_CATEGORIES = [
    {"id": "netease-hot", "platform": "网易云音乐", "name": "热门", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=热门"},
    {"id": "netease-chinese", "platform": "网易云音乐", "name": "华语", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=华语"},
    {"id": "netease-pop", "platform": "网易云音乐", "name": "流行", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=流行"},
    {"id": "netease-classic", "platform": "网易云音乐", "name": "经典", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=经典"},
    {"id": "netease-cantonese", "platform": "网易云音乐", "name": "粤语", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=粤语"},
    {"id": "netease-ost", "platform": "网易云音乐", "name": "影视原声", "count": 0, "url": "https://music.163.com/#/discover/playlist/?cat=影视原声"},
    {"id": "qq-hot", "platform": "QQ 音乐", "name": "热门歌单", "count": 0, "url": "https://y.qq.com/n/ryqq/category"},
    {"id": "qq-chinese", "platform": "QQ 音乐", "name": "华语推荐", "count": 0, "url": "https://y.qq.com/n/ryqq/category"},
    {"id": "qq-cantonese", "platform": "QQ 音乐", "name": "粤语推荐", "count": 0, "url": "https://y.qq.com/n/ryqq/category"},
    {"id": "kugou-hot", "platform": "酷狗音乐", "name": "热歌精选", "count": 0, "url": "https://www.kugou.com/yy/special/index/1-0-0.html"},
]


def _netease_get(path: str, params: dict | None = None):
    headers = {
        "User-Agent": "Mozilla/5.0 SongLib-Amp/0.8",
        "Referer": "https://music.163.com/",
        "Accept": "application/json,text/plain,*/*",
    }
    with httpx.Client(timeout=httpx.Timeout(8, read=12), follow_redirects=True) as client:
        response = client.get("https://music.163.com" + path, params=params or {}, headers=headers)
        response.raise_for_status()
        return response.json()


def _playlist_summary(item: dict) -> dict:
    creator = item.get("creator") or {}
    return {
        "id": str(item.get("id") or ""),
        "platform": "网易云音乐",
        "title": item.get("name") or "未命名歌单",
        "description": re.sub(r"\s+", " ", item.get("description") or "").strip()[:180],
        "coverUrl": item.get("coverImgUrl") or item.get("picUrl") or "",
        "trackCount": int(item.get("trackCount") or 0),
        "playCount": int(item.get("playCount") or 0),
        "creator": creator.get("nickname") or "网易云音乐",
        "sourceUrl": f"https://music.163.com/#/playlist?id={item.get('id')}",
    }


@app.get("/api/discovery/playlists", dependencies=[Depends(auth.current_user)])
def discovery_playlists(category: str = "热门"):
    categories = []
    source = "curated-fallback"
    playlist_items = []
    error = ""
    try:
        data = _netease_get("/api/playlist/hottags")
        for index, item in enumerate(data.get("tags") or []):
            name = item.get("name")
            if not name:
                continue
            categories.append({
                "id": f"netease-{item.get('id') or index}",
                "platform": "网易云音乐",
                "name": name,
                "count": int(item.get("usedCount") or item.get("count") or 0),
                "url": f"https://music.163.com/#/discover/playlist/?cat={quote(name)}",
            })
        if categories:
            source = "netease-hottags"
        playlist_data = _netease_get("/api/playlist/list", {"cat": category, "order": "hot", "offset": 0, "total": "true", "limit": 18})
        playlist_items = [_playlist_summary(item) for item in (playlist_data.get("playlists") or [])]
    except Exception as exc:
        error = str(exc)
        categories = []
    merged = categories + [item for item in CURATED_PLAYLIST_CATEGORIES if item["name"] not in {c["name"] for c in categories}]
    return {
        "source": source,
        "updatedAt": now(),
        "categories": merged[:40],
        "playlists": playlist_items,
        "selectedCategory": category,
        "platforms": sorted({item["platform"] for item in merged}),
        "error": error,
    }


@app.get("/api/discovery/playlists/{playlist_id}", dependencies=[Depends(auth.current_user)])
def discovery_playlist_detail(playlist_id: str, user=Depends(auth.current_user)):
    if not playlist_id.isdigit():
        raise HTTPException(status_code=400, detail="歌单编号无效")
    try:
        data = _netease_get("/api/v6/playlist/detail", {"id": playlist_id, "n": 1000, "s": 0})
        playlist = data.get("playlist") or {}
        playlist_tracks = list(playlist.get("tracks") or [])
        known_ids = {str(item.get("id")) for item in playlist_tracks if item.get("id")}
        missing_ids = [str(item.get("id")) for item in (playlist.get("trackIds") or []) if item.get("id") and str(item.get("id")) not in known_ids][:300]
        for start in range(0, len(missing_ids), 100):
            ids = missing_ids[start:start + 100]
            extra = _netease_get("/api/song/detail", {"ids": json.dumps(ids, ensure_ascii=False)}).get("songs") or []
            playlist_tracks.extend(extra)
        raw_tracks = []
        for item in playlist_tracks[:300]:
            artists = item.get("ar") or item.get("artists") or []
            album = item.get("al") or item.get("album") or {}
            raw_tracks.append({
                "platform": "wy",
                "platformTrackId": str(item.get("id") or ""),
                "title": item.get("name") or "",
                "artist": " / ".join(filter(None, [artist.get("name") for artist in artists])),
                "album": album.get("name") or "",
                "duration": round(int(item.get("dt") or item.get("duration") or 0) / 1000),
                "coverUrl": album.get("picUrl") or "",
            })
        tracks = match_external_tracks(raw_tracks, scopes=user.get("libraryScopes"))
        enabled_sources = [item for item in list_sources() if item.get("enabled") and item.get("searchOk")]
        for item in tracks:
            item["canDownload"] = item.get("matchStatus") != "matched" and bool(enabled_sources)
        return {
            "playlist": _playlist_summary(playlist),
            "tracks": tracks,
            "summary": {
                "total": len(tracks),
                "matched": len([item for item in tracks if item.get("matchStatus") == "matched"]),
                "downloadable": len([item for item in tracks if item.get("canDownload")]),
                "unavailable": len([item for item in tracks if item.get("matchStatus") != "matched" and not item.get("canDownload")]),
            },
            "downloadSource": ({"id": enabled_sources[0]["id"], "name": enabled_sources[0].get("displayName")} if enabled_sources else None),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"读取平台歌单失败：{exc}") from exc


@app.post("/api/discovery/download-missing", dependencies=[Depends(auth.current_user)])
def discovery_download_missing(body: DiscoveryDownloadBody):
    source = get_source(body.sourceId)
    if not source.get("enabled") or not source.get("searchOk"):
        raise HTTPException(status_code=409, detail="所选音乐源尚未启用或搜索测试未通过")
    created, errors = [], []
    platform = "wy" if "wy" in (source.get("supportedPlatforms") or []) else None
    for track in body.tracks[:50]:
        title = str(track.get("title") or "").strip()
        artist = str(track.get("artist") or "").strip()
        if not title:
            continue
        try:
            result = test_search(body.sourceId, f"{title} {artist}".strip(), platform)
            candidates = result.get("results") or []
            exact = next((item for item in candidates if normalize_catalog_text(item.get("title")) == normalize_catalog_text(title) and (not artist or normalize_catalog_text(artist) in normalize_catalog_text(item.get("artist")))), None)
            item = exact or (candidates[0] if candidates else None)
            if not item:
                raise ValueError("没有找到可下载候选")
            payload = {"sourceId": body.sourceId, "quality": body.quality, "item": item}
            payload["preflight"] = preflight_download(body.sourceId, item, body.quality)
            created.append(manager.create("download", f"下载 {item.get('artist', '')} - {item.get('title', '')}", payload))
        except Exception as exc:
            errors.append({"title": title, "artist": artist, "error": str(exc)})
    return {"created": len(created), "errors": errors, "jobs": created}


def _page(items, page: int, page_size: int):
    total = len(items)
    start = max(0, (page - 1) * page_size)
    return {"items": items[start:start + page_size], "total": total, "page": page, "pageSize": page_size}


def _decorate(items):
    keys = [str(item.get("ratingKey") or item.get("rating_key") or "") for item in items if item.get("ratingKey") or item.get("rating_key")]
    synced = {}
    if keys:
        placeholders = ",".join("?" for _ in keys)
        synced = {str(item["rating_key"]): item for item in rows(f"SELECT * FROM plex_items WHERE rating_key IN ({placeholders})", tuple(keys))}
    for item in items:
        key = str(item.get("ratingKey") or item.get("rating_key") or "")
        state = synced.get(key) or {}
        item["ratingKey"] = key
        item["synced"] = bool(state)
        item["hasCover"] = bool(state.get("has_cover") or item.get("thumb"))
        item["hasBackground"] = bool(state.get("has_background") or item.get("art"))
        item["hasLyrics"] = bool(state.get("has_lyrics"))
        item["hasChineseBio"] = bool(state.get("artist_bio_zh") or state.get("album_description_zh"))
        item["lastSyncedAt"] = state.get("last_synced_at")
        if item.get("thumb"):
            item["thumbUrl"] = "/api/plex/image?path=" + quote(item["thumb"], safe="")
        if item.get("art"):
            item["artUrl"] = "/api/plex/image?path=" + quote(item["art"], safe="")
    return items


def _clean_base_url(value: str, field: str, required=True):
    value = (value or "").strip().rstrip("/")
    if not value and not required:
        return ""
    if not value:
        raise HTTPException(status_code=400, detail=f"{field}不能为空")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail=f"{field}必须是 http 或 https 地址")
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail=f"{field}不能带多余路径、查询参数或片段")
    return f"{parsed.scheme}://{parsed.netloc}"


def _plex_settings_public(include_token=False):
    data = plex.saved_settings()
    libraries = []
    try:
        libraries = plex.libraries()
    except Exception:
        libraries = []
    return {
        "enabled": data["enabled"],
        "name": data["name"],
        "serverUrl": data["serverUrl"],
        "externalUrl": data.get("externalUrl") or "",
        "token": data["token"] if include_token else "",
        "hasToken": bool(data.get("token") or plex._token),
        "selectedLibraryKeys": data.get("selectedLibraryKeys") or "all",
        "lastConnectedAt": data.get("lastConnectedAt"),
        "lastSyncAt": data.get("lastSyncAt"),
        "libraries": libraries,
        "syncedLibraryCount": len([item for item in libraries if item.get("enabled")]),
    }


@app.get("/api/settings/plex", dependencies=[Depends(auth.current_user)])
def get_plex_settings():
    return _plex_settings_public()


@app.post("/api/settings/plex", dependencies=[Depends(auth.current_user)])
def save_plex_settings(body: PlexSettingsBody):
    server_url = _clean_base_url(body.serverUrl, "服务器地址")
    external_url = _clean_base_url(body.externalUrl, "外网播放地址", required=False)
    selected = body.selectedLibraryKeys
    if body.enabled and not selected:
        raise HTTPException(status_code=400, detail="启用 Plex 后必须选择同步媒体库")
    current = plex.saved_settings()
    token = body.token.strip() or current.get("token", "")
    if body.enabled and not token:
        raise HTTPException(status_code=400, detail="Token 不能为空")
    value = {
        **current,
        "enabled": body.enabled,
        "name": body.name.strip() or "Plex",
        "serverUrl": server_url,
        "externalUrl": external_url,
        "token": token,
        "selectedLibraryKeys": selected,
    }
    set_kv("plex_settings", value)
    return {"ok": True, "settings": _plex_settings_public()}


@app.post("/api/plex/test", dependencies=[Depends(auth.current_user)])
def test_plex_connection(body: PlexTestBody | None = None):
    saved = plex.saved_settings()
    server_url = _clean_base_url((body.serverUrl if body else None) or saved["serverUrl"], "服务器地址")
    token = ((body.token if body else None) or saved.get("token") or plex.token).strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token 不能为空")
    try:
        result = plex.test_connection(base_url=server_url, token=token)
    except Exception as exc:
        message = str(exc)
        if "401" in message or "Unauthorized" in message:
            raise HTTPException(status_code=401, detail="Token 无效，请重新获取 X-Plex-Token。") from exc
        raise HTTPException(status_code=502, detail=f"无法连接 Plex，请检查服务器地址。{message}") from exc
    if result["libraryCount"] <= 0:
        raise HTTPException(status_code=404, detail="未识别到音乐资料库。")
    current = plex.saved_settings()
    current.update({
        "serverUrl": server_url,
        "token": token,
        "lastConnectedAt": result["connectedAt"],
        "machineIdentifier": result.get("machineIdentifier") or "",
    })
    set_kv("plex_settings", current)
    return {"ok": True, "message": f"Plex 连接成功，已识别到 {result['libraryCount']} 个音乐资料库。", **result}


@app.get("/api/plex/libraries", dependencies=[Depends(auth.current_user)])
def plex_libraries():
    try:
        return {"items": plex.libraries()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Plex 返回异常，请查看网络或 Token 权限。{exc}") from exc


@app.post("/api/plex/sync", dependencies=[Depends(auth.current_user)])
def sync_plex_library():
    return manager.create("plex_sync", "同步 Plex 音乐资料库", {})


@app.get("/api/plex/items/{rating_key}/playback", dependencies=[Depends(auth.current_user)])
def plex_item_playback(rating_key: str):
    try:
        return plex.playback_info(rating_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法播放该 Plex 曲目，请检查 Plex Token、服务器地址或媒体文件权限。{exc}") from exc


@app.get("/api/library/artists", dependencies=[Depends(auth.current_user)])
def artists(page: int = 1, pageSize: int = Query(48, ge=1, le=200), search: str = ""):
    try:
        return _page(_decorate(plex.artists(search=search)), page, pageSize)
    except Exception as exc:
        items = rows("SELECT rating_key AS ratingKey,title,thumb,art,summary FROM plex_items WHERE type='artist' AND title LIKE ? ORDER BY title", (f"%{search}%",))
        return {**_page(_decorate(items), page, pageSize), "warning": f"Plex 暂不可用，显示最近同步数据：{exc}"}


@app.get("/api/library/albums", dependencies=[Depends(auth.current_user)])
def albums(page: int = 1, pageSize: int = Query(48, ge=1, le=200), search: str = ""):
    try:
        return _page(_decorate(plex.albums(search=search)), page, pageSize)
    except Exception as exc:
        items = rows("SELECT rating_key AS ratingKey,title,artist AS parentTitle,year,thumb,art,summary FROM plex_items WHERE type='album' AND (title LIKE ? OR artist LIKE ?) ORDER BY artist,title", (f"%{search}%", f"%{search}%"))
        return {**_page(_decorate(items), page, pageSize), "warning": f"Plex 暂不可用，显示最近同步数据：{exc}"}


@app.get("/api/library/tracks", dependencies=[Depends(auth.current_user)])
def tracks(page: int = 1, pageSize: int = Query(50, ge=1, le=200), search: str = ""):
    try:
        return _page(_decorate(plex.tracks(search=search)), page, pageSize)
    except Exception as exc:
        items = rows("SELECT rating_key AS ratingKey,title,artist AS grandparentTitle,album AS parentTitle,year,duration,thumb,art,file_path AS file FROM plex_items WHERE type='track' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?) ORDER BY artist,album,title", (f"%{search}%", f"%{search}%", f"%{search}%"))
        return {**_page(_decorate(items), page, pageSize), "warning": f"Plex 暂不可用，显示最近同步数据：{exc}"}


@app.get("/api/plex/image", dependencies=[Depends(auth.current_user)])
def plex_image(path: str):
    try:
        data = plex.image(path)
        return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
    except Exception as exc:
        raise HTTPException(status_code=404, detail="图片不存在") from exc


@app.post("/api/plex/scan", dependencies=[Depends(auth.current_user)])
def plex_scan():
    return manager.create("plex_scan", "扫描 Plex 音乐资料库", {})


@app.get("/api/jobs", dependencies=[Depends(auth.current_user)])
def jobs(limit: int = Query(50, ge=1, le=200)):
    return list_jobs(limit)


@app.get("/api/jobs/{job_id}", dependencies=[Depends(auth.current_user)])
def job(job_id: int):
    result = get_job(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="任务不存在")
    return result


@app.get("/api/jobs/{job_id}/logs", dependencies=[Depends(auth.current_user)])
def job_logs(job_id: int):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="任务不存在")
    return list_job_logs(job_id)


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(auth.current_user)])
def cancel_job(job_id: int):
    try:
        return manager.cancel(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/jobs/{job_id}/retry", dependencies=[Depends(auth.current_user)])
def retry_job(job_id: int):
    try:
        return manager.retry(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/jobs", dependencies=[Depends(auth.current_user)])
def create_job(body: JobBody):
    titles = {
        "scrape_artists": "更新歌手海报、背景与中文简介",
        "scrape_plex_metadata": "补全 Plex 歌手与专辑元数据",
        "fill_album_covers": "补齐缺失专辑封面",
        "fill_lyrics": "补齐缺失时间轴歌词",
        "fill_assets": "补齐专辑封面与歌词",
        "fill_local_tags": "补齐本地音频标签",
        "plex_scan": "扫描 Plex 音乐资料库",
        "local_scan": "扫描 NAS 本地曲库",
        "plex_sync": "同步 Plex 条目与本地文件",
        "local_organize": "整理本地目录与文件名",
    }
    if body.kind not in titles:
        raise HTTPException(status_code=400, detail="不支持的任务类型")
    return manager.create(body.kind, titles[body.kind], body.payload)


@app.post("/api/scrape/preview", dependencies=[Depends(auth.current_user)])
def scrape_preview(body: ScrapePreviewBody):
    allowed = {"scrape_artists", "scrape_plex_metadata", "fill_album_covers", "fill_lyrics", "fill_assets", "fill_local_tags", "local_organize"}
    if body.kind not in allowed:
        raise HTTPException(status_code=400, detail="不支持该预览类型")
    try:
        plan = build_diff_preview(body.kind, body.scope, body.mode, body.limit, body.scopeValue)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"生成差异预览失败：{exc}") from exc
    plans = get_kv("scrape_preview_plans", {}) or {}
    plans[plan["id"]] = plan
    # Keep the latest plans only; previews expire naturally when the container restarts.
    set_kv("scrape_preview_plans", dict(list(plans.items())[-30:]))
    return plan


@app.post("/api/scrape/apply", dependencies=[Depends(auth.current_user)])
def scrape_apply(body: ScrapeApplyBody):
    plans = get_kv("scrape_preview_plans", {}) or {}
    plan = plans.pop(body.planId, None)
    if not plan:
        raise HTTPException(status_code=409, detail="预览已失效，请重新生成后再确认")
    set_kv("scrape_preview_plans", plans)
    titles = {
        "scrape_artists": "更新歌手海报、背景与中文简介",
        "scrape_plex_metadata": "补全 Plex 歌手与专辑元数据",
        "fill_album_covers": "补齐缺失专辑封面",
        "fill_lyrics": "补齐缺失时间轴歌词",
        "fill_assets": "补齐专辑封面与歌词",
        "fill_local_tags": "补齐本地音频标签",
        "local_organize": "整理本地目录与文件名",
    }
    payload = {
        "scope": plan["scope"], "scopeValue": plan.get("scopeValue") or "", "mode": plan["mode"],
        "items": plan.get("items") or [], "confirmedPlanId": body.planId,
    }
    return manager.create(plan["kind"], titles[plan["kind"]], payload)


@app.get("/api/sources", dependencies=[Depends(auth.current_user)])
def sources():
    return list_sources()


@app.post("/api/sources", dependencies=[Depends(auth.current_user)])
def create_source(body: SourceBody):
    return import_url(body.name, str(body.url))


@app.post("/api/sources/import-url", dependencies=[Depends(auth.current_user)])
def source_import_url(body: SourceImportUrlBody):
    return import_url(body.name, body.url)


@app.post("/api/sources/import-file", dependencies=[Depends(auth.current_user)])
async def source_import_file(file: UploadFile = File(...), name: str = Form("")):
    data = await file.read(settings.source_max_size_mb * 1024 * 1024 + 1)
    return import_file(name, file.filename or "", file.content_type, data)


@app.post("/api/sources/import-code", dependencies=[Depends(auth.current_user)])
def source_import_code(body: SourceImportCodeBody):
    return import_code(body.name, body.code)


@app.get("/api/sources/{source_id}", dependencies=[Depends(auth.current_user)])
def source_detail(source_id: str):
    return get_source(source_id)


@app.post("/api/sources/{source_id}/enable", dependencies=[Depends(auth.current_user)])
def source_enable(source_id: str):
    return set_enabled(source_id, True)


@app.post("/api/sources/{source_id}/disable", dependencies=[Depends(auth.current_user)])
def source_disable(source_id: str):
    return set_enabled(source_id, False)


@app.post("/api/sources/{source_id}/inspect", dependencies=[Depends(auth.current_user)])
def source_inspect(source_id: str):
    return inspect_source(source_id)


@app.post("/api/sources/{source_id}/test-search", dependencies=[Depends(auth.current_user)])
def source_test_search(source_id: str, body: SourceSearchBody):
    return test_search(source_id, body.keyword, body.platform)


@app.post("/api/sources/{source_id}/test-resolve", dependencies=[Depends(auth.current_user)])
def source_test_resolve(source_id: str, body: SourceResolveBody):
    return test_resolve(source_id, body.track, body.quality)


@app.get("/api/sources/{source_id}/logs", dependencies=[Depends(auth.current_user)])
def get_source_logs(source_id: str, limit: int = Query(100, ge=1, le=500)):
    return source_logs(source_id, limit)


@app.delete("/api/sources/{source_id}", dependencies=[Depends(auth.current_user)])
def remove_source(source_id: str):
    delete_source(source_id)
    return {"ok": True}


@app.get("/api/catalog/search", dependencies=[Depends(auth.current_user)])
def search_catalog(q: str = Query(min_length=1, max_length=100), platform: str = "tx"):
    try:
        return catalog_search(q, platform)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"搜索失败：{exc}") from exc


@app.get("/api/catalog/unified", dependencies=[Depends(auth.current_user)])
def search_unified_catalog(q: str = Query(default="", max_length=100), limit: int = Query(50, ge=1, le=200), user=Depends(auth.current_user)):
    """One user-facing song entity with local/Plex resources attached."""
    return unified_tracks(q.strip(), limit, scopes=user.get("libraryScopes"))


@app.post("/api/downloads", dependencies=[Depends(auth.current_user)])
def create_download(body: DownloadBody):
    payload = body.model_dump()
    item = payload["item"]
    payload["preflight"] = preflight_download(body.sourceId, item, body.quality)
    title = f"下载 {item.get('artist', '')} - {item.get('title', '')}"
    return manager.create("download", title, payload)


def _pending_download_items(limit=200):
    items = []
    for job in list_jobs(limit):
        if job.get("kind") != "download" or job.get("status") != "waiting_confirm":
            continue
        result = job.get("result") or {}
        preview = result.get("preview") or {}
        items.append({
            "jobId": job["id"],
            "title": preview.get("title") or job.get("title", "").replace("下载 ", ""),
            "artist": preview.get("artist") or "",
            "album": preview.get("album") or "Unknown Album",
            "quality": preview.get("quality") or (job.get("payload") or {}).get("quality") or "",
            "source": ((result.get("source") or {}).get("displayName") or (job.get("payload") or {}).get("sourceId") or ""),
            "downloadPath": preview.get("incomingPath") or "",
            "targetPath": preview.get("targetPath") or "",
            "stage": "pending_confirmation",
            "stageLabel": "临时区 · 待确认",
            "currentPath": preview.get("incomingPath") or "",
            "proposedPath": preview.get("targetPath") or "",
            "tagStatus": "标签已准备" if not result.get("tagWarning") else "标签需检查",
            "coverStatus": "封面已准备" if result.get("cover") else "缺封面",
            "lyricStatus": "歌词已准备" if result.get("lyrics") else "缺歌词",
            "conflict": bool(preview.get("conflict") or preview.get("conflictAdjusted")),
            "createdAt": job.get("created_at"),
            "preview": preview,
        })
    return items


@app.get("/api/downloads/pending", dependencies=[Depends(auth.current_user)])
def pending_downloads():
    items = _pending_download_items()
    return {"items": items, "total": len(items)}


def _create_download_decision(job_id: int, action: str):
    job = get_job(job_id)
    if not job or job.get("kind") != "download":
        raise HTTPException(status_code=404, detail="下载任务不存在")
    if job.get("status") != "waiting_confirm":
        raise HTTPException(status_code=409, detail="该下载任务当前不在等待确认状态")
    preview = (job.get("result") or {}).get("preview")
    if action == "confirm":
        return manager.create("organize_confirm", f"确认入库 · {job['title']}", {"downloadJobId": job_id, "preview": preview})
    if action == "cancel":
        return manager.create("organize_cancel", f"删除待入库 · {job['title']}", {"downloadJobId": job_id, "preview": preview})
    raise HTTPException(status_code=400, detail="不支持的操作")


@app.post("/api/downloads/{job_id}/confirm", dependencies=[Depends(auth.current_user)])
def confirm_download_job(job_id: int):
    return _create_download_decision(job_id, "confirm")


@app.post("/api/downloads/{job_id}/cancel", dependencies=[Depends(auth.current_user)])
def cancel_download_job(job_id: int):
    return _create_download_decision(job_id, "cancel")


@app.post("/api/downloads/batch-confirm", dependencies=[Depends(auth.current_user)])
def confirm_download_batch(body: BatchDownloadDecisionBody):
    return {"items": [_create_download_decision(job_id, "confirm") for job_id in body.jobIds]}


@app.post("/api/downloads/batch-cancel", dependencies=[Depends(auth.current_user)])
def cancel_download_batch(body: BatchDownloadDecisionBody):
    return {"items": [_create_download_decision(job_id, "cancel") for job_id in body.jobIds]}


def _stream_tokens() -> dict:
    tokens = get_kv("stream_tokens", {}) or {}
    current = time.time()
    cleaned = {key: value for key, value in tokens.items() if float(value.get("expires", 0)) > current}
    if len(cleaned) != len(tokens):
        set_kv("stream_tokens", cleaned)
    return cleaned


def _issue_stream_token(resolved: dict, filename: str = "", ttl: int = 60 * 60 * 2) -> str:
    tokens = _stream_tokens()
    token = secrets.token_urlsafe(24)
    tokens[token] = {
        "url": resolved.get("url"),
        "headers": resolved.get("headers") or {},
        "filename": filename,
        "expires": time.time() + ttl,
    }
    set_kv("stream_tokens", tokens)
    return token


def _stream_token_payload(token: str) -> dict:
    tokens = _stream_tokens()
    payload = tokens.get(token)
    if not payload:
        raise HTTPException(status_code=404, detail="播放或下载链接已过期，请重新解析。")
    return payload


def _stream_external_audio(payload: dict, request: Request, *, disposition: str = "inline"):
    target = payload.get("url")
    if not target:
        raise HTTPException(status_code=404, detail="播放地址不存在，请重新解析。")
    headers = {"User-Agent": "Mozilla/5.0", **(payload.get("headers") or {})}
    if request.headers.get("range"):
        headers["Range"] = request.headers["range"]
    client = httpx.Client(timeout=None, follow_redirects=True)
    try:
        upstream = client.build_request("GET", target, headers=headers)
        response = client.send(upstream, stream=True)
        response.raise_for_status()
    except Exception as exc:
        client.close()
        raise HTTPException(status_code=502, detail=f"音乐源播放流代理失败：{exc}") from exc

    passthrough = {}
    for key in ("content-type", "content-length", "content-range", "accept-ranges", "cache-control"):
        value = response.headers.get(key)
        if value:
            passthrough[key] = value
    filename = payload.get("filename") or "songlib-amp-audio"
    if disposition == "attachment":
        passthrough["content-disposition"] = f"attachment; filename*=UTF-8''{quote(filename)}"
    media_type = response.headers.get("content-type", "audio/mpeg")

    def iterator():
        try:
            for chunk in response.iter_bytes(1024 * 128):
                if chunk:
                    yield chunk
        finally:
            response.close()
            client.close()

    return StreamingResponse(iterator(), status_code=response.status_code, media_type=media_type, headers=passthrough)


def _download_filename(item: dict, quality: str, content_type: str = "") -> str:
    title = str(item.get("title") or "未命名歌曲").strip()
    artist = str(item.get("artist") or "未知歌手").strip()
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0]) if content_type else ""
    ext = ".flac" if quality.startswith("flac") else guessed or ".mp3"
    safe = "".join(ch if ch not in '\\/:*?"<>|' else "_" for ch in f"{artist} - {title}")[:120].strip(" .")
    return (safe or "songlib-amp-audio") + ext


@app.post("/api/downloads/device-token", dependencies=[Depends(auth.current_user)])
def device_download_token(body: DownloadBody):
    try:
        resolved = resolve_track(body.sourceId, body.item, body.quality, require_enabled=True)
        preflight = preflight_download(body.sourceId, body.item, body.quality)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"当前设备下载地址解析失败：{exc}") from exc
    filename = _download_filename(body.item, body.quality, preflight.get("contentType") or "")
    token = _issue_stream_token(resolved, filename=filename, ttl=60 * 30)
    return {
        "ok": True,
        "filename": filename,
        "size": preflight.get("size"),
        "contentType": preflight.get("contentType"),
        "downloadUrl": f"/api/downloads/device/{quote(token, safe='')}",
    }


@app.get("/api/downloads/device/{token}", dependencies=[Depends(auth.current_user)])
def device_download_stream(token: str, request: Request):
    return _stream_external_audio(_stream_token_payload(token), request, disposition="attachment")


@app.get("/api/local/files", dependencies=[Depends(auth.current_user)])
def local_files(search: str = "", missing: str = "", limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0), user=Depends(auth.current_user)):
    return local_library.list(search, missing, limit, offset, scopes=user.get("libraryScopes"))


@app.get("/api/local/categories", dependencies=[Depends(auth.current_user)])
def local_categories():
    return local_library.categories()


@app.get("/api/local/files/{file_id}", dependencies=[Depends(auth.current_user)])
def local_file(file_id: str):
    try: return local_library.get(file_id)
    except KeyError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc


def _local_file_path(file_id: str, user: dict | None = None) -> Path:
    try:
        item = local_library.get(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = Path(item["path"])
    if user is not None:
        scopes = user.get("libraryScopes") or []
        if "*" not in scopes:
            try:
                relative = path.resolve().relative_to(settings.music_root.resolve())
            except Exception as exc:
                raise HTTPException(status_code=403, detail="文件不在授权曲库范围内") from exc
            allowed = any(scope and ".." not in scope.split("/") and (relative.as_posix() == scope.strip("/") or relative.as_posix().startswith(scope.strip("/") + "/")) for scope in scopes)
            if not allowed:
                raise HTTPException(status_code=403, detail="当前账号无权访问该目录")
    if not path.exists():
        raise HTTPException(status_code=404, detail="本地音频文件已不存在")
    return path


def _embedded_cover(path: Path):
    audio = MutagenFile(path, easy=False)
    if not audio:
        return None
    pictures = getattr(audio, "pictures", None)
    if pictures:
        pic = pictures[0]
        return pic.data, pic.mime or "image/jpeg"
    tags = getattr(audio, "tags", None) or {}
    for key, value in tags.items():
        upper = str(key).upper()
        if upper.startswith("APIC"):
            return value.data, value.mime or "image/jpeg"
        if str(key).lower() == "covr" and value:
            data = bytes(value[0])
            mime = "image/png" if getattr(value[0], "imageformat", None) == 14 else "image/jpeg"
            return data, mime
    return None


@app.get("/api/local/files/{file_id}/stream", dependencies=[Depends(auth.current_user)])
def stream_local_file_alias(file_id: str, user=Depends(auth.current_user)):
    path = _local_file_path(file_id, user)
    return FileResponse(path, filename=path.name, content_disposition_type="inline")


@app.get("/api/local/files/{file_id}/cover", dependencies=[Depends(auth.current_user)])
def local_file_cover(file_id: str, user=Depends(auth.current_user)):
    path = _local_file_path(file_id, user)
    embedded = _embedded_cover(path)
    if embedded:
        data, mime = embedded
        return Response(content=data, media_type=mime, headers={"Cache-Control": "private, max-age=86400"})
    for name in ("cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"):
        candidate = path.parent / name
        if candidate.exists():
            media_type = "image/png" if candidate.suffix.lower() == ".png" else "image/jpeg"
            return FileResponse(candidate, media_type=media_type, content_disposition_type="inline")
    raise HTTPException(status_code=404, detail="封面不存在")


@app.get("/api/local/files/{file_id}/lyrics", dependencies=[Depends(auth.current_user)])
def local_file_lyrics(file_id: str, user=Depends(auth.current_user)):
    path = _local_file_path(file_id, user)
    for suffix in (".lrc", ".txt"):
        lyric = path.with_suffix(suffix)
        if lyric.exists():
            return {"lyrics": lyric.read_text(encoding="utf-8", errors="ignore"), "format": suffix.lstrip(".")}
    audio = MutagenFile(path, easy=False)
    tags = getattr(audio, "tags", {}) if audio else {}
    for key in ("USLT::XXX", "LYRICS", "©lyr", "lyrics"):
        value = tags.get(key) if tags else None
        if value:
            return {"lyrics": str(value[0] if isinstance(value, list) else value), "format": "text"}
    return {"lyrics": "", "format": "none"}


@app.get("/api/local/artists/{artist_id}/background", dependencies=[Depends(auth.current_user)])
def local_artist_background(artist_id: str):
    candidate = local_artist_background_file(artist_id)
    if candidate:
        media_map = {
            ".png": "image/png",
            ".webp": "image/webp",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
        }
        return FileResponse(candidate, media_type=media_map.get(candidate.suffix.lower(), "image/jpeg"), content_disposition_type="inline")
    raise HTTPException(status_code=404, detail="歌手背景不存在")


@app.patch("/api/local/files/{file_id}/tags", dependencies=[Depends(auth.current_user)])
def update_local_tags(file_id: str, body: TagUpdateBody):
    try: return local_library.update_tags(file_id, body.changes)
    except (KeyError, ValueError) as exc: raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/local/scan", dependencies=[Depends(auth.current_user)])
def scan_local_files():
    return manager.create("local_scan", "扫描 NAS 本地曲库", {})


@app.post("/api/local/sync-plex", dependencies=[Depends(auth.current_user)])
def sync_local_plex():
    return manager.create("plex_sync", "同步 Plex 条目与本地文件", {})


@app.post("/api/local/organize/preview", dependencies=[Depends(auth.current_user)])
def organize_preview(body: OrganizePreviewBody):
    return {"items": organizer.preview(body.fileIds), "dryRun": True}


@app.post("/api/local/organize/apply", dependencies=[Depends(auth.current_user)])
def organize_apply(body: OrganizeApplyBody):
    return manager.create("local_organize", "确认执行本地曲库整理", {"previews": body.previews})


@app.get("/api/local/operations", dependencies=[Depends(auth.current_user)])
def operation_logs(limit: int = Query(100, ge=1, le=500)):
    from .db import rows
    return rows("SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ?", (limit,))


@app.post("/api/local/operations/{operation_id}/rollback", dependencies=[Depends(auth.current_user)])
def rollback_operation(operation_id: str):
    try: return local_library.rollback(operation_id)
    except ValueError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/player/local/{file_id}/stream", dependencies=[Depends(auth.current_user)])
def stream_local_file(file_id: str):
    try: item = local_library.get(file_id)
    except KeyError as exc: raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = Path(item["path"])
    if not path.exists(): raise HTTPException(status_code=404, detail="本地音频文件已不存在")
    return FileResponse(path, filename=path.name, content_disposition_type="inline")


@app.get("/api/player/local/{file_id}", dependencies=[Depends(auth.current_user)])
def local_playback_info(file_id: str, user=Depends(auth.current_user)):
    try:
        item = local_library.get(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = Path(item["path"])
    _local_file_path(file_id, user)
    cover = path.parent / "cover.jpg"
    return {
        "source": "local_file",
        "id": file_id,
        "title": item.get("title") or path.stem,
        "artist": item.get("artist") or "未知歌手",
        "album": item.get("album") or "未知专辑",
        "duration": int(item.get("duration") or 0) * 1000,
        "file": str(path),
        "streamUrl": f"/api/local/files/{file_id}/stream",
        "coverUrl": f"/api/local/files/{file_id}/cover" if cover.exists() or _embedded_cover(path) else "",
        "artistBackgroundUrl": f"/api/local/artists/{quote(item.get('album_artist') or item.get('artist') or '', safe='')}/background",
        "lyricsUrl": f"/api/local/files/{file_id}/lyrics",
        "qualities": ["original"],
    }


@app.get("/api/player/local/{file_id}/cover", dependencies=[Depends(auth.current_user)])
def local_cover(file_id: str):
    try:
        item = local_library.get(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    cover = Path(item["path"]).parent / "cover.jpg"
    if not cover.exists():
        raise HTTPException(status_code=404, detail="封面不存在")
    return FileResponse(cover, media_type="image/jpeg", content_disposition_type="inline")


@app.get("/api/player/local/{file_id}/lyrics", dependencies=[Depends(auth.current_user)])
def local_lyrics(file_id: str):
    try:
        item = local_library.get(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    lyric_path = Path(item["path"]).with_suffix(".lrc")
    if not lyric_path.exists():
        return {"lyrics": "", "format": "lrc"}
    return {"lyrics": lyric_path.read_text(encoding="utf-8", errors="ignore"), "format": "lrc"}


@app.get("/api/player/plex/{rating_key}", dependencies=[Depends(auth.current_user)])
def plex_playback_info(rating_key: str, bitrate: str = "original"):
    try:
        info = plex.playback(rating_key, bitrate)
        info["rawStreamUrl"] = info.get("streamUrl")
        info["streamUrl"] = f"/api/player/plex/{quote(str(rating_key), safe='')}/stream?bitrate={quote(bitrate, safe='')}"
        return info
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法播放该 Plex 曲目，请检查 Plex Token、服务器地址或媒体文件权限。{exc}") from exc


@app.get("/api/player/plex/{rating_key}/stream", dependencies=[Depends(auth.current_user)])
def plex_stream(rating_key: str, request: Request, bitrate: str = "original"):
    try:
        stream_url = plex.playback(rating_key, bitrate)["streamUrl"]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法播放该 Plex 曲目，请检查 Plex Token、服务器地址或媒体文件权限。{exc}") from exc
    headers = {}
    if request.headers.get("range"):
        headers["Range"] = request.headers["range"]
    client = httpx.Client(timeout=None, follow_redirects=True)
    try:
        upstream = client.build_request("GET", stream_url, headers=headers)
        response = client.send(upstream, stream=True)
        response.raise_for_status()
    except Exception as exc:
        client.close()
        raise HTTPException(status_code=502, detail=f"Plex 播放流代理失败：{exc}") from exc

    passthrough = {}
    for key in ("content-type", "content-length", "content-range", "accept-ranges", "cache-control"):
        value = response.headers.get(key)
        if value:
            passthrough[key] = value
    media_type = response.headers.get("content-type", "audio/mpeg")

    def iterator():
        try:
            for chunk in response.iter_bytes(1024 * 128):
                if chunk:
                    yield chunk
        finally:
            response.close()
            client.close()

    return StreamingResponse(iterator(), status_code=response.status_code, media_type=media_type, headers=passthrough)


@app.get("/api/player/plex/{rating_key}/lyrics", dependencies=[Depends(auth.current_user)])
def plex_lyrics(rating_key: str):
    try:
        info = plex.playback(rating_key, "original")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"读取 Plex 曲目失败：{exc}") from exc
    file_path = info.get("file") or ""
    path = Path(file_path)
    if not path.exists():
        return {"lyrics": "", "format": "lrc"}
    lyric_path = path.with_suffix(".lrc")
    if not lyric_path.exists():
        return {"lyrics": "", "format": "lrc"}
    return {"lyrics": lyric_path.read_text(encoding="utf-8", errors="ignore"), "format": "lrc"}


@app.post("/api/player/source-preview", dependencies=[Depends(auth.current_user)])
def source_preview(body: SourcePreviewBody):
    try:
        resolved = resolve_track(body.sourceId, body.item, body.quality, require_enabled=False)
        token = _issue_stream_token(
            resolved,
            filename=_download_filename(body.item, body.quality),
            ttl=60 * 30,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"试听地址解析失败：{exc}") from exc
    return {
        "source": "source_preview",
        "title": body.item.get("title") or "",
        "artist": body.item.get("artist") or "",
        "album": body.item.get("album") or "",
        "coverUrl": body.item.get("coverUrl") or body.item.get("cover") or "",
        "streamUrl": f"/api/player/source-preview/{quote(token, safe='')}/stream",
        "quality": body.quality,
        "item": body.item,
    }


@app.get("/api/player/source-preview/{token}/stream", dependencies=[Depends(auth.current_user)])
def source_preview_stream(token: str, request: Request):
    return _stream_external_audio(_stream_token_payload(token), request, disposition="inline")


def _avatar_file(user_id: str) -> Path | None:
    profile_dir = settings.data_dir / "profile" / user_id
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = profile_dir / ("avatar" + ext)
        if candidate.exists():
            return candidate
    return None


def _profile_payload(user: dict):
    profiles = get_kv("user_profiles", {}) or {}
    profile = profiles.get(user.get("id"), {})
    if not profile and user.get("username") == "admin":
        profile = get_kv("user_profile", {}) or {}
    avatar = _avatar_file(user.get("id") or "unknown")
    if avatar:
        profile["avatarUrl"] = f"/api/profile/avatar?v={int(avatar.stat().st_mtime)}"
    return {
        "username": user.get("username"),
        "displayName": profile.get("displayName") or user.get("displayName") or user.get("username"),
        "role": user.get("role") or "listener",
        "permissions": user.get("permissions") or ["listen"],
        "avatarUrl": profile.get("avatarUrl") or "",
        "theme": profile.get("theme") or "dark",
        "defaultSource": profile.get("defaultSource") or "tx",
        "defaultQuality": profile.get("defaultQuality") or "320k",
    }


@app.get("/api/profile", dependencies=[Depends(auth.current_user)])
def get_profile(user=Depends(auth.current_user)):
    return _profile_payload(user)


@app.patch("/api/profile", dependencies=[Depends(auth.current_user)])
def update_profile(body: SettingsPatchBody, user=Depends(auth.current_user)):
    profiles = get_kv("user_profiles", {}) or {}
    current = profiles.get(user.get("id"), {})
    allowed = {"displayName", "theme", "defaultSource", "defaultQuality"}
    for key, value in body.values.items():
        if key in allowed:
            current[key] = value
    profiles[user.get("id")] = current
    set_kv("user_profiles", profiles)
    return {"ok": True, "profile": _profile_payload(user)}


@app.get("/api/player/state", dependencies=[Depends(auth.current_user)])
def get_player_state(user=Depends(auth.current_user)):
    states = get_kv("player_states", {}) or {}
    return states.get(user.get("id"), {"queue": [], "favorites": {}, "history": [], "playEvents": [], "playlists": {}})


@app.patch("/api/player/state", dependencies=[Depends(auth.current_user)])
def update_player_state(body: SettingsPatchBody, user=Depends(auth.current_user)):
    values = body.values or {}
    clean = {
        "queue": list(values.get("queue") or [])[:200],
        "favorites": dict(list((values.get("favorites") or {}).items())[:1000]),
        "history": list(values.get("history") or [])[:200],
        "playEvents": list(values.get("playEvents") or [])[:2000],
        "playlists": dict(list((values.get("playlists") or {}).items())[:200]),
        "currentTrack": values.get("currentTrack") or None,
        "updatedAt": now(),
    }
    states = get_kv("player_states", {}) or {}
    states[user.get("id")] = clean
    set_kv("player_states", states)
    return {"ok": True, "state": clean}


@app.post("/api/profile/avatar", dependencies=[Depends(auth.current_user)])
async def upload_profile_avatar(file: UploadFile = File(...), user=Depends(auth.current_user)):
    data = await file.read(4 * 1024 * 1024 + 1)
    if not data or len(data) > 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="头像文件需要小于 4MB。")
    content_type = (file.content_type or "").split(";", 1)[0].lower()
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    ext = ext_map.get(content_type) or Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(status_code=400, detail="头像仅支持 JPG、PNG 或 WebP。")
    profile_dir = settings.data_dir / "profile" / (user.get("id") or "unknown")
    profile_dir.mkdir(parents=True, exist_ok=True)
    for old in profile_dir.glob("avatar.*"):
        old.unlink(missing_ok=True)
    target = profile_dir / ("avatar" + (".jpg" if ext == ".jpeg" else ext))
    target.write_bytes(data)
    return {"ok": True, "profile": _profile_payload(user)}


@app.get("/api/profile/avatar", dependencies=[Depends(auth.current_user)])
def profile_avatar(user=Depends(auth.current_user)):
    avatar = _avatar_file(user.get("id") or "unknown")
    if not avatar:
        raise HTTPException(status_code=404, detail="头像不存在")
    media = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
    return FileResponse(avatar, media_type=media.get(avatar.suffix.lower(), "image/jpeg"), content_disposition_type="inline")


@app.get("/api/logs/summary", dependencies=[Depends(auth.current_user)])
def logs_summary(limit: int = Query(80, ge=1, le=300)):
    return {
        "updatedAt": now(),
        "jobs": list_jobs(30),
        "jobLogs": rows("""SELECT job_logs.*,jobs.title AS job_title,jobs.kind AS job_kind
            FROM job_logs LEFT JOIN jobs ON jobs.id=job_logs.job_id
            ORDER BY job_logs.created_at DESC LIMIT ?""", (limit,)),
        "sourceLogs": rows("""SELECT source_logs.*,source_plugins.display_name AS source_name
            FROM source_logs LEFT JOIN source_plugins ON source_plugins.id=source_logs.source_id
            ORDER BY source_logs.created_at DESC LIMIT ?""", (limit,)),
        "operations": rows("SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ?", (limit,)),
    }


@app.get("/api/settings", dependencies=[Depends(auth.current_user)])
def get_settings(user=Depends(auth.current_user)):
    overrides = get_kv("ui_settings", {}) or {}
    plex_public = _plex_settings_public()
    naming_templates = {
        "album": "{artist}/{album} ({year})/{trackNumber} - {title}.{ext}",
        "multiDisc": "{artist}/{album} ({year})/Disc {discNumber}/{trackNumber} - {title}.{ext}",
        "compilation": "Various Artists/{album} ({year})/{trackNumber} - {artist} - {title}.{ext}",
        "unknown": "{artist}/Unknown Album/{title}.{ext}",
    }
    return {
        "appName": settings.app_name,
        "version": settings.app_version,
        "plex": plex_public,
        "plexServerName": plex_public["name"],
        "musicRoot": str(settings.music_root),
        "plexUrl": plex_public["serverUrl"],
        "plexSection": settings.plex_section,
        "externalPlexUrl": plex_public["externalUrl"] or plex_public["serverUrl"],
        "downloadDir": settings.download_dir,
        "downloadTempDir": str(settings.download_root),
        "incomingDir": str(settings.incoming_dir),
        "manualDownloadDir": str(settings.manual_download_dir),
        "trashDir": str(settings.trash_dir),
        "lyricRule": overrides.get("lyricRule", "同名 .lrc"),
        "coverRule": overrides.get("coverRule", "专辑目录 cover.jpg + 音频内嵌封面"),
        "scrapeRules": overrides.get("scrapeRules", {
            "defaultMode": "missing", "writeCover": True, "writeLyrics": True,
            "refreshPlex": True, "skipExistingCover": True, "skipExistingLyrics": True,
        }),
        "namingTemplates": overrides.get("namingTemplates", naming_templates),
        "excludeDirs": overrides.get("excludeDirs", [str(settings.incoming_dir), str(settings.download_root), str(settings.trash_dir), "/music/@eaDir", "/music/#recycle"]),
        "player": overrides.get("player", {
            "defaultSource": "local_first",
            "remoteBitrate": "320k",
            "autoTranscode": False,
            "showLyrics": True,
            "blurBackground": True,
            "extractColor": True,
        }),
        "user": {**overrides.get("user", {
            "username": "admin",
            "theme": "dark",
            "defaultSource": "tx",
            "defaultQuality": "320k",
        }), **_profile_payload(user)},
        "maxDownloadMb": settings.max_download_mb,
        "sourceMaxSizeMb": settings.source_max_size_mb,
        "privateDownloadUrlsAllowed": settings.allow_private_download_urls,
    }


@app.patch("/api/settings", dependencies=[Depends(auth.current_user)])
def update_settings(body: SettingsPatchBody):
    current = get_kv("ui_settings", {}) or {}
    current.update(body.values)
    set_kv("ui_settings", current)
    return {"ok": True, "settings": current}


@app.get("/api/playlists")
def playlists(user=Depends(auth.current_user)):
    return {"items": playlist_service.list_playlists(user["id"])}


@app.post("/api/playlists")
def create_playlist(body: PlaylistBody, request: Request, user=Depends(auth.current_user)):
    item = playlist_service.create_playlist(user["id"], body.name, body.description, body.items)
    audit.record(user["id"], request.state.request_id, "playlist.create", "playlist", item["id"], "success", {"itemCount": item["itemCount"]})
    return item


@app.get("/api/playlists/{playlist_id}")
def get_playlist(playlist_id: str, user=Depends(auth.current_user)):
    return playlist_service.get_playlist(playlist_id, user["id"], user["role"] in ("owner", "admin"))


@app.patch("/api/playlists/{playlist_id}")
def update_playlist(playlist_id: str, body: PlaylistPatchBody, request: Request, user=Depends(auth.current_user)):
    item = playlist_service.update_playlist(
        playlist_id,
        user["id"],
        name=body.name,
        description=body.description,
        items=body.items,
    )
    audit.record(user["id"], request.state.request_id, "playlist.update", "playlist", playlist_id, "success", {"itemCount": item["itemCount"]})
    return item


@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str, request: Request, user=Depends(auth.current_user)):
    playlist_service.delete_playlist(playlist_id, user["id"])
    audit.record(user["id"], request.state.request_id, "playlist.delete", "playlist", playlist_id, "success")
    return {"ok": True}


@app.post("/api/playlists/import/m3u")
def import_playlist_m3u(body: M3UImportBody, request: Request, user=Depends(auth.current_user)):
    result = playlist_service.import_m3u(user["id"], body.name, body.content, body.pathMappings)
    audit.record(
        user["id"],
        request.state.request_id,
        "playlist.import",
        "playlist",
        result["playlist"]["id"],
        "success",
        {"matched": result["matched"], "unmatched": len(result["unmatched"])},
    )
    return result


@app.get("/api/playlists/{playlist_id}/export.m3u")
def export_playlist_m3u(playlist_id: str, user=Depends(auth.current_user)):
    name, content = playlist_service.export_m3u(playlist_id, user["id"])
    filename = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", name)[:100] or "playlist"
    return Response(
        content=content,
        media_type="audio/x-mpegurl; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{quote(filename)}.m3u8"'},
    )


@app.post("/api/listening/events")
def listening_event(body: ListeningEventBody, user=Depends(auth.current_user)):
    return recommendation_service.record_event(
        user["id"],
        body.eventType,
        body.fileId,
        body.externalRef,
        body.positionMs,
        body.durationMs,
        body.context,
    )


@app.get("/api/recommendations")
def recommendations(user=Depends(auth.current_user)):
    return recommendation_service.list_recommendations(user["id"])


@app.post("/api/recommendations/refresh")
def refresh_recommendations(body: RecommendationRefreshBody, request: Request, user=Depends(auth.current_user)):
    result = recommendation_service.refresh(user["id"], body.discoveries, body.exploration)
    audit.record(
        user["id"],
        request.state.request_id,
        "recommendation.refresh",
        "profile",
        user["id"],
        "success",
        {"candidateCount": len(result["items"]), "exploration": body.exploration},
    )
    return result


@app.get("/api/audit/events")
def audit_events(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth.current_user)):
    if user["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="只有管理员可以查看审计记录")
    return {"items": audit.list_events(limit)}


def _backup_dir() -> Path:
    directory = settings.data_dir / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _backup_path(name: str) -> Path:
    safe = Path(name).name
    if safe != name or not re.fullmatch(r"songlib-\d{8}-\d{6}\.db", safe):
        raise HTTPException(status_code=400, detail="备份文件名无效")
    return _backup_dir() / safe


@app.get("/api/backups", dependencies=[Depends(auth.current_user)])
def list_backups():
    items = []
    for path in sorted(_backup_dir().glob("songlib-*.db"), reverse=True):
        stat = path.stat()
        items.append({"name": path.name, "size": stat.st_size, "createdAt": datetime.fromtimestamp(stat.st_mtime).isoformat()})
    return {"items": items}


@app.post("/api/backups", dependencies=[Depends(auth.current_user)])
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


@app.get("/api/backups/{name}/download", dependencies=[Depends(auth.current_user)])
def download_backup(name: str):
    path = _backup_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="备份不存在")
    return FileResponse(path, filename=path.name, media_type="application/x-sqlite3")


@app.post("/api/backups/{name}/restore", dependencies=[Depends(auth.current_user)])
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


STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static"))
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        target = STATIC_DIR / full_path
        if full_path and target.is_file() and STATIC_DIR in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(STATIC_DIR / "index.html")
