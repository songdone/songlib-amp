from __future__ import annotations

import gzip
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
from urllib.parse import quote, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .routers.health import router as health_router
from .routers.accounts import router as accounts_router
from .routers.insights import router as insights_router
from .routers.backups import router as backups_router
from . import audit
from .airplay_cast import cast_manager
from .catalog import search as catalog_search
from .config import settings
from .db import get_kv, init_db, now, row, rows, set_kv
from .download_inbox import download_inbox
from .fnos_music import fnos_music
from .jobs import get_job, list_job_logs, list_jobs, manager
from .local_library import local_library, organizer
from .lyrics import find_lyrics
from .media_lyrics import read_local_lyrics
from .plex import dashboard_stats, local_artist_background_file, local_media_path, plex
from .playback_positions import forget as forget_position, get as get_position, recent as recent_positions, save as save_position
from .plex_companion import plex_companion
from .scraper import build_diff_preview
from .security import SecurityMiddleware, client_key, issue_csrf, rate_limiter
from . import playlists as playlist_service
from .playlist_migration import export_to_plex, import_to_songlib, preview_share_link, strict_candidate
from . import recommendations as recommendation_service
from . import discovery
from .unified_catalog import match_external_tracks, normalize as normalize_catalog_text, unified_tracks
from .sources import (
    SourceError, delete_source, get_source, import_code, import_file, import_url, list_sources,
    inspect_source, resolve_track, resolve_track_with_fallback, set_enabled, source_catalog_ready,
    source_logs, test_resolve, test_search,
)
from mutagen import File as MutagenFile


from .schemas import ( LoginBody, SetupBody, PlaylistBody, PlaylistPatchBody, M3UImportBody,
    PlaylistSharePreviewBody, PlaylistMigrationBody, PlaylistSyncBody, ListeningEventBody,
    RecommendationRefreshBody, ChangePasswordBody, UserCreateBody, UserUpdateBody,
    UserPasswordBody, SourceBody, SourceImportUrlBody, SourceImportCodeBody, SourceSearchBody,
    SourceResolveBody, JobBody, DownloadBody, BatchDownloadDecisionBody, SourcePreviewBody,
    SettingsPatchBody, PlexSettingsBody, PlexTestBody, PlexRemoteCommandBody, FnosSettingsBody,
    TagUpdateBody, TagFillPreviewBody, RollbackBatchBody, PlaybackPositionBody, OrganizePreviewBody, OrganizeApplyBody, DownloadInboxApplyBody,
    ScrapePreviewBody, ScrapeApplyBody, DiscoveryDownloadBody, AirPlayCastUpdateBody,
    AirPlayCastClockBody,
)


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
        cast_manager.shutdown()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.add_middleware(SecurityMiddleware)
app.include_router(health_router)
app.include_router(accounts_router)
app.include_router(insights_router)
app.include_router(backups_router)


@app.exception_handler(SourceError)
def source_error_handler(request: Request, exc: SourceError):
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error_code": exc.code, "message": exc.message})


_dashboard_plex_cache = {"at": 0.0, "value": None}


def _cached_dashboard_stats(ttl_seconds: float = 30.0):
    stamp = time.monotonic()
    if (
        _dashboard_plex_cache["value"] is not None
        and stamp - _dashboard_plex_cache["at"] < ttl_seconds
    ):
        return dict(_dashboard_plex_cache["value"])
    value = dashboard_stats()
    _dashboard_plex_cache.update({"at": stamp, "value": value})
    return dict(value)


@app.get("/api/dashboard", dependencies=[Depends(auth.current_user)])
def dashboard():
    try:
        result = _cached_dashboard_stats()
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


@app.get("/api/discovery/platforms", dependencies=[Depends(auth.current_user)])
def discovery_platforms():
    """平台能力清单。纯静态，不打任何外部接口 —— 前端要先画出平台选择器。"""
    return {"items": discovery.platform_list()}


@app.get("/api/discovery/playlists", dependencies=[Depends(auth.current_user)])
def discovery_playlists(platform: str = "netease", category: str = ""):
    try:
        result = discovery.browse(platform, category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result["updatedAt"] = now()
    return result


@app.get("/api/discovery/playlists/{playlist_id}", dependencies=[Depends(auth.current_user)])
def discovery_playlist_detail(
    playlist_id: str, platform: str = "netease", user=Depends(auth.current_user)
):
    try:
        provider = discovery.provider_for(platform)
        playlist, raw_tracks = provider.detail(playlist_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"读取平台歌单失败：{exc}") from exc

    tracks = match_external_tracks(raw_tracks, scopes=user.get("libraryScopes"))
    enabled_sources = [item for item in list_sources() if source_catalog_ready(item)]
    for item in tracks:
        item["canDownload"] = item.get("matchStatus") != "matched" and bool(enabled_sources)
    return {
        "playlist": playlist,
        "tracks": tracks,
        "summary": {
            "total": len(tracks),
            "matched": len([item for item in tracks if item.get("matchStatus") == "matched"]),
            "downloadable": len([item for item in tracks if item.get("canDownload")]),
            "unavailable": len([
                item for item in tracks
                if item.get("matchStatus") != "matched" and not item.get("canDownload")
            ]),
        },
        "downloadSource": (
            {"id": enabled_sources[0]["id"], "name": enabled_sources[0].get("displayName")}
            if enabled_sources else None
        ),
    }


@app.post("/api/discovery/download-missing", dependencies=[Depends(auth.current_user)])
def discovery_download_missing(body: DiscoveryDownloadBody):
    source = get_source(body.sourceId)
    if not source_catalog_ready(source):
        raise HTTPException(status_code=409, detail="所选音乐源已停用或尚未识别到音乐接口")
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


_PLEX_ART_OWNER = re.compile(r"/library/metadata/([^/]+)/art(?:/|$)")


def _artist_art_path(artist: dict | None, *related_groups: list[dict]) -> str:
    """Return only Plex art that is provably owned by the requested artist."""
    if not artist:
        return ""
    expected_key = str(artist.get("ratingKey") or artist.get("rating_key") or "")
    expected_title = str(artist.get("title") or "").strip().casefold()
    if not expected_key:
        return ""

    def belongs(item: dict) -> bool:
        item_type = str(item.get("type") or "")
        item_key = str(item.get("ratingKey") or item.get("rating_key") or "")
        if item is artist or item_type == "artist":
            return item_key == expected_key
        if item_type == "album":
            key = str(item.get("parentRatingKey") or "")
            title = str(item.get("parentTitle") or "").strip().casefold()
        else:
            key = str(item.get("grandparentRatingKey") or "")
            title = str(item.get("grandparentTitle") or "").strip().casefold()
        return key == expected_key and (not title or not expected_title or title == expected_title)

    candidates = [artist]
    for group in related_groups:
        candidates.extend(group or [])
    for item in candidates:
        if not belongs(item):
            continue
        for field in ("art", "grandparentArt", "parentArt"):
            path = str(item.get(field) or "")
            if not path:
                continue
            owner = _PLEX_ART_OWNER.search(path)
            if owner and owner.group(1) != expected_key:
                continue
            return path
    return ""


def _attach_artist_background(artist: dict | None, *related_groups: list[dict]):
    if not artist:
        return artist
    path = _artist_art_path(artist, *related_groups)
    artist["backgroundUrl"] = (
        "/api/plex/image?path=" + quote(path, safe="") if path else ""
    )
    return artist


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


@app.get("/api/plex/remote/sessions", dependencies=[Depends(auth.current_user)])
def plex_remote_sessions():
    saved = plex.saved_settings()
    if not saved.get("enabled") or not saved.get("serverUrl"):
        raise HTTPException(status_code=409, detail="请先连接 Plex，再查看其他设备的播放状态")
    try:
        return plex_companion.sessions()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail="Plex Token 无权读取活动播放会话") from exc
        raise HTTPException(status_code=502, detail="Plex 暂时无法返回活动播放会话") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"读取 Plex 播放设备失败：{exc}") from exc


@app.post("/api/plex/remote/clients/{client_id}/commands", dependencies=[Depends(auth.current_user)])
def plex_remote_command(client_id: str, body: PlexRemoteCommandBody):
    try:
        return plex_companion.command(client_id, body.action, body.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"目标 Plex 播放器拒绝了控制请求（HTTP {exc.response.status_code}）",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="无法连接目标 Plex 播放器，请确认应用仍在前台且允许远程控制") from exc


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


@app.get("/api/library/artists/{rating_key}", dependencies=[Depends(auth.current_user)])
def artist_detail(rating_key: str):
    try:
        artist = _decorate([plex.metadata(rating_key)])[0]
        albums = _decorate(plex.children(rating_key))
        tracks = _decorate(plex.all_leaves(rating_key))
        tracks.sort(
            key=lambda item: (
                int(item.get("viewCount") or 0),
                int(item.get("lastViewedAt") or 0),
                int(item.get("ratingCount") or 0),
            ),
            reverse=True,
        )
        _attach_artist_background(artist, albums, tracks)
        return {
            "artist": artist,
            "albums": albums,
            "popularTracks": tracks[:10],
            "trackCount": len(tracks),
            "albumCount": len(albums),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法读取该歌手资料：{exc}") from exc


@app.get("/api/library/albums", dependencies=[Depends(auth.current_user)])
def albums(page: int = 1, pageSize: int = Query(48, ge=1, le=200), search: str = ""):
    try:
        return _page(_decorate(plex.albums(search=search)), page, pageSize)
    except Exception as exc:
        items = rows("SELECT rating_key AS ratingKey,title,artist AS parentTitle,year,thumb,art,summary FROM plex_items WHERE type='album' AND (title LIKE ? OR artist LIKE ?) ORDER BY artist,title", (f"%{search}%", f"%{search}%"))
        return {**_page(_decorate(items), page, pageSize), "warning": f"Plex 暂不可用，显示最近同步数据：{exc}"}


@app.get("/api/library/albums/{rating_key}", dependencies=[Depends(auth.current_user)])
def album_detail(rating_key: str):
    try:
        album = _decorate([plex.metadata(rating_key)])[0]
        tracks = _decorate(plex.children(rating_key))
        tracks.sort(
            key=lambda item: (
                int(item.get("parentIndex") or item.get("disc") or 0),
                int(item.get("index") or item.get("track") or 0),
                item.get("title") or "",
            )
        )
        artist_key = str(album.get("parentRatingKey") or "")
        artist = (
            _decorate([plex.metadata(artist_key)])[0]
            if artist_key
            else None
        )
        _attach_artist_background(artist, tracks)
        return {
            "album": album,
            "artist": artist,
            "tracks": tracks,
            "trackCount": len(tracks),
            "duration": sum(int(item.get("duration") or 0) for item in tracks),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法读取该专辑资料：{exc}") from exc


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
        resolved = resolve_track_with_fallback(body.sourceId, body.item, body.quality, require_enabled=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"当前设备下载地址解析失败：{exc}") from exc
    resolved_quality = resolved.get("quality") or body.quality
    filename = _download_filename(body.item, resolved_quality)
    token = _issue_stream_token(resolved, filename=filename, ttl=60 * 30)
    return {
        "ok": True,
        "filename": filename,
        "size": None,
        "contentType": None,
        "quality": resolved_quality,
        "qualityFallback": resolved_quality != body.quality,
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
def local_file(file_id: str, user=Depends(auth.current_user)):
    _local_file_path(file_id, user)
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
    return read_local_lyrics(path)


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


@app.put("/api/playback/position", dependencies=[Depends(auth.current_user)])
def put_playback_position(body: PlaybackPositionBody, user=Depends(auth.current_user)):
    """Remember where this user is in this track.

    Client sends this on a timer and on pause/unload; it is deliberately
    idempotent so a duplicate from a flaky connection costs nothing.
    """
    try:
        return save_position(user["id"], body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/playback/position", dependencies=[Depends(auth.current_user)])
def read_playback_position(trackKey: str, user=Depends(auth.current_user)):
    return get_position(user["id"], trackKey) or {}


@app.delete("/api/playback/position", dependencies=[Depends(auth.current_user)])
def clear_playback_position(trackKey: str, user=Depends(auth.current_user)):
    return forget_position(user["id"], trackKey)


@app.get("/api/playback/resume", dependencies=[Depends(auth.current_user)])
def list_resume_points(limit: int = Query(12, ge=1, le=60), user=Depends(auth.current_user)):
    """Tracks this user left part-way through, newest first."""
    return {"items": recent_positions(user["id"], limit)}


@app.get("/api/local/health", dependencies=[Depends(auth.current_user)])
def local_library_health():
    """Whole-library checkup. Every issue comes with the page that fixes it."""
    return local_library.health()


@app.post("/api/local/tags/preview", dependencies=[Depends(auth.current_user)])
def tag_fill_preview(body: TagFillPreviewBody):
    return local_library.missing_tag_preview(body.fileIds)


@app.post("/api/local/organize/preview", dependencies=[Depends(auth.current_user)])
def organize_preview(body: OrganizePreviewBody):
    return {"items": organizer.preview(body.fileIds), "dryRun": True}


@app.post("/api/local/organize/apply", dependencies=[Depends(auth.current_user)])
def organize_apply(body: OrganizeApplyBody):
    return manager.create("local_organize", "确认执行本地曲库整理", {"previews": body.previews})


@app.get("/api/local/download-inbox", dependencies=[Depends(auth.current_user)])
def download_inbox_preview(limit: int = Query(default=500, ge=1, le=2_000)):
    return download_inbox.preview(limit)


@app.post("/api/local/download-inbox/ingest", dependencies=[Depends(auth.current_user)])
def download_inbox_ingest(body: DownloadInboxApplyBody):
    source_paths = "|".join(sorted(str(item.get("sourcePath") or "") for item in body.items))
    return manager.create(
        "download_inbox_ingest",
        f"整理并入库 {len(body.items)} 首歌曲",
        {"items": body.items},
        idempotency_key=f"download-inbox:{uuid.uuid5(uuid.NAMESPACE_URL, source_paths).hex}",
    )


@app.get("/api/local/operations", dependencies=[Depends(auth.current_user)])
def operation_logs(limit: int = Query(300, ge=1, le=500)):
    """Change history as a timeline, grouped by run, with decoded diffs.

    This used to return raw rows with before/after still JSON-encoded, which
    is why the page could only ever show "写入标签 · 成功".
    """
    return local_library.operation_timeline(limit)


@app.post("/api/local/operations/rollback", dependencies=[Depends(auth.current_user)])
def rollback_operations(body: RollbackBatchBody):
    """Roll back a whole run. Partial failures are reported, not raised."""
    return local_library.rollback_many(body.ids)


@app.post("/api/local/operations/{operation_id}/rollback", dependencies=[Depends(auth.current_user)])
def rollback_operation(operation_id: str):
    try: return local_library.rollback(operation_id)
    except ValueError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/player/local/{file_id}/stream", dependencies=[Depends(auth.current_user)])
def stream_local_file(file_id: str, user=Depends(auth.current_user)):
    path = _local_file_path(file_id, user)
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
def local_cover(file_id: str, user=Depends(auth.current_user)):
    return local_file_cover(file_id, user)


@app.get("/api/player/local/{file_id}/lyrics", dependencies=[Depends(auth.current_user)])
def local_lyrics(file_id: str, user=Depends(auth.current_user)):
    try:
        item = local_library.get(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = _local_file_path(file_id, user)
    local = read_local_lyrics(path)
    if local["lyrics"]:
        return local
    lyrics, source = find_lyrics(item)
    return {"lyrics": lyrics, "format": "lrc", "source": source or ""}


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
    path = local_media_path(info.get("file") or "")
    if path and path.exists():
        local = read_local_lyrics(path)
        if local["lyrics"]:
            return local
    try:
        plex_lyric = plex.lyrics(
            rating_key,
            stream_key=info.get("lyricStreamKey") or "",
            stream_format=info.get("lyricFormat") or "",
        )
    except Exception:
        plex_lyric = {"lyrics": "", "format": "none", "source": ""}
    if plex_lyric["lyrics"]:
        return plex_lyric
    lyrics, source = find_lyrics(info)
    return {"lyrics": lyrics, "format": "lrc", "source": source or ""}


@app.post("/api/player/source-preview", dependencies=[Depends(auth.current_user)])
def source_preview(body: SourcePreviewBody):
    try:
        resolved = resolve_track_with_fallback(body.sourceId, body.item, body.quality, require_enabled=False)
        token = _issue_stream_token(
            resolved,
            filename=_download_filename(body.item, resolved.get("quality") or body.quality),
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
        "quality": resolved.get("quality") or body.quality,
        "qualityFallback": bool(resolved.get("qualityFallback")),
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
        "fontSize": profile.get("fontSize") or "standard",
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
    allowed = {
        "displayName",
        "theme",
        "fontSize",
        "defaultSource",
        "defaultQuality",
    }
    for key, value in body.values.items():
        if key in allowed:
            if key == "fontSize" and value not in ("compact", "standard", "large"):
                continue
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


def _airplay_public_base(request: Request) -> str:
    return settings.airplay_public_base_url or str(request.base_url).rstrip("/")


def _airplay_cover(body: AirPlayCastUpdateBody, user: dict) -> bytes | None:
    # Artwork is optional decoration. A missing sidecar, a stale Plex thumb or
    # a temporary Plex outage must never prevent title, lyrics and clock state
    # from reaching an already-connected Apple TV session.
    try:
        if body.sourceType == "local_file" and body.localFileId:
            path = _local_file_path(body.localFileId, user)
            embedded = _embedded_cover(path)
            if embedded:
                return embedded[0]
            for name in ("cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"):
                candidate = path.parent / name
                if candidate.is_file() and candidate.stat().st_size <= 12 * 1024 * 1024:
                    return candidate.read_bytes()
        if body.sourceType in {"plex_item", "plex_session"} and body.plexRatingKey:
            info = plex.playback(body.plexRatingKey, "original")
            thumb = info.get("thumb") or ""
            if thumb:
                data = plex.image(thumb)
                return data[: 12 * 1024 * 1024]
    except (KeyError, OSError, RuntimeError, ValueError, httpx.HTTPError):
        return None
    return None


@app.post("/api/airplay/cast", dependencies=[Depends(auth.current_user)])
def create_airplay_cast(request: Request, user=Depends(auth.current_user)):
    rate_limiter.check(client_key(request, "airplay-cast-create"), limit=12, window_seconds=60)
    try:
        session = cast_manager.create(user["id"], _airplay_public_base(request))
        return cast_manager.status(session.session_id, user["id"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/airplay/cast/{session_id}", dependencies=[Depends(auth.current_user)])
def airplay_cast_status(session_id: str, user=Depends(auth.current_user)):
    try:
        return cast_manager.status(session_id, user["id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/airplay/cast/{session_id}", dependencies=[Depends(auth.current_user)])
def update_airplay_cast(session_id: str, body: AirPlayCastUpdateBody, user=Depends(auth.current_user)):
    try:
        changed = cast_manager.visual_changed(
            session_id,
            user["id"],
            body.trackId,
            body.coverKey,
        )
        cover = _airplay_cover(body, user) if changed else None
        return cast_manager.update(session_id, user["id"], body.model_dump(), cover)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="无法更新歌词投屏画面") from exc


@app.patch("/api/airplay/cast/{session_id}/clock", dependencies=[Depends(auth.current_user)])
def update_airplay_cast_clock(
    session_id: str,
    body: AirPlayCastClockBody,
    user=Depends(auth.current_user),
):
    try:
        return cast_manager.update_clock(
            session_id,
            user["id"],
            body.model_dump(),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/airplay/cast/{session_id}", dependencies=[Depends(auth.current_user)])
def stop_airplay_cast(session_id: str, user=Depends(auth.current_user)):
    try:
        cast_manager.stop(session_id, user["id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


def _airplay_stream_headers(*, playlist: bool) -> dict[str, str]:
    return {
        "Cache-Control": "no-store" if playlist else "public, max-age=4, immutable",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Accept-Ranges": "bytes",
    }


def _airplay_playlist_response(content: str | bytes, request: Request) -> Response:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    headers = _airplay_stream_headers(playlist=True)
    headers["Vary"] = "Accept-Encoding"
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        payload = gzip.compress(payload, compresslevel=4)
        headers["Content-Encoding"] = "gzip"
    return Response(
        content=payload,
        media_type="application/vnd.apple.mpegurl",
        headers=headers,
    )


@app.get("/api/airplay/stream/{token}/master.m3u8")
def airplay_master_playlist(token: str, request: Request):
    try:
        content = cast_manager.master_playlist(token)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _airplay_playlist_response(content, request)


@app.get("/api/airplay/stream/{token}/{filename}")
def airplay_stream_file(token: str, filename: str, request: Request):
    try:
        target = cast_manager.stream_file(token, filename)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    media_type = {
        ".m3u8": "application/vnd.apple.mpegurl",
        ".mp4": "video/mp4",
        ".m4s": "video/iso.segment",
    }.get(target.suffix.lower(), "application/octet-stream")
    if target.suffix.lower() == ".m3u8":
        return _airplay_playlist_response(target.read_bytes(), request)
    return FileResponse(
        target,
        media_type=media_type,
        content_disposition_type="inline",
        headers=_airplay_stream_headers(playlist=target.suffix.lower() == ".m3u8"),
    )


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
        "downloadTrashDir": str(settings.download_trash_dir),
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
        "fnosMusic": fnos_music.public_settings(),
    }


@app.patch("/api/settings", dependencies=[Depends(auth.current_user)])
def update_settings(body: SettingsPatchBody):
    current = get_kv("ui_settings", {}) or {}
    current.update(body.values)
    set_kv("ui_settings", current)
    return {"ok": True, "settings": current}


@app.post("/api/settings/fnos", dependencies=[Depends(auth.current_user)])
def save_fnos_music(
    body: FnosSettingsBody, user=Depends(auth.current_user)
):
    if user["role"] not in ("owner", "admin"):
        raise HTTPException(
            status_code=403,
            detail="只有所有者或管理员可以修改飞牛音乐连接",
        )
    server_url = _clean_base_url(body.serverUrl, "飞牛音乐地址")
    try:
        public = fnos_music.configure(
            server_url=server_url,
            auth_mode=body.authMode,
            username=body.username,
            password=body.password,
            token=body.token,
        )
        return {
            "ok": True,
            "message": "飞牛音乐已连接，账号密码未保存",
            "fnosMusic": public,
        }
    except (ValueError, RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/settings/fnos/test", dependencies=[Depends(auth.current_user)])
def test_fnos_music():
    try:
        result = fnos_music.test()
        return {"ok": True, "message": f"飞牛音乐连接成功，已读取 {result['playlistCount']} 个歌单"}
    except (RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/playlists")
def playlists(user=Depends(auth.current_user)):
    return {"items": playlist_service.list_playlists(user["id"])}


@app.get("/api/playlists/services")
def connected_service_playlists(user=Depends(auth.current_user)):
    result = {
        "plex": {"configured": False, "items": [], "error": None},
        "fnos": {"configured": False, "items": [], "error": None},
    }
    plex_settings = plex.saved_settings()
    result["plex"]["configured"] = bool(
        plex_settings.get("enabled") and plex_settings.get("serverUrl")
    )
    if result["plex"]["configured"]:
        try:
            result["plex"]["items"] = [
                {
                    "id": str(item.get("ratingKey") or ""),
                    "name": item.get("title") or "未命名歌单",
                    "itemCount": int(item.get("leafCount") or 0),
                    "duration": int(item.get("duration") or 0),
                    "updatedAt": item.get("updatedAt"),
                    "coverUrl": (
                        "/api/plex/image?path="
                        + quote(item.get("composite") or "", safe="")
                        if item.get("composite")
                        else ""
                    ),
                }
                for item in plex.playlists()
                if item.get("ratingKey")
            ]
        except (RuntimeError, ValueError, httpx.HTTPError):
            result["plex"]["error"] = "暂时无法读取 Plex 歌单，请在设置中测试连接。"
    result["fnos"]["configured"] = fnos_music.configured
    if result["fnos"]["configured"]:
        try:
            result["fnos"]["items"] = fnos_music.playlists()
        except (RuntimeError, ValueError, httpx.HTTPError):
            result["fnos"]["error"] = "暂时无法读取飞牛音乐歌单，请在设置中测试连接。"
    return result


@app.get("/api/playlists/services/plex/{playlist_id}")
def connected_plex_playlist(playlist_id: str, user=Depends(auth.current_user)):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", playlist_id):
        raise HTTPException(status_code=400, detail="Plex 歌单标识无效")
    plex_settings = plex.saved_settings()
    if not plex_settings.get("enabled") or not plex_settings.get("serverUrl"):
        raise HTTPException(status_code=409, detail="Plex 尚未连接")
    try:
        items = _decorate(plex.playlist_items(playlist_id))
    except (RuntimeError, ValueError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail="暂时无法读取该 Plex 歌单") from exc
    return {
        "service": "plex",
        "id": playlist_id,
        "items": [
            {
                **item,
                "source": "plex_item",
                "artist": item.get("grandparentTitle") or item.get("originalTitle") or "",
                "album": item.get("parentTitle") or "",
                "coverUrl": item.get("thumbUrl") or "",
            }
            for item in items
            if item.get("ratingKey")
        ],
        "itemCount": len(items),
    }


@app.post("/api/playlists")
def create_playlist(body: PlaylistBody, request: Request, user=Depends(auth.current_user)):
    item = playlist_service.create_playlist(user["id"], body.name, body.description, body.items)
    audit.record(user["id"], request.state.request_id, "playlist.create", "playlist", item["id"], "success", {"itemCount": item["itemCount"]})
    return item


@app.post("/api/playlists/migrate/preview")
def playlist_migration_preview(body: PlaylistSharePreviewBody, user=Depends(auth.current_user)):
    try:
        result = preview_share_link(body.shareUrl, scopes=user.get("libraryScopes"))
        sources = [
            {"id": item["id"], "name": item.get("displayName") or item.get("name")}
            for item in list_sources()
            if source_catalog_ready(item)
        ]
        result["downloadSources"] = sources
        result["targets"] = {
            "songlib": {"available": True},
            "plex": {"available": bool(plex.saved_settings().get("serverUrl"))},
            "fnos": {"available": fnos_music.configured},
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"暂时无法读取这个歌单：{exc}") from exc


@app.post("/api/playlists/migrate/execute")
def playlist_migration_execute(
    body: PlaylistMigrationBody,
    request: Request,
    user=Depends(auth.current_user),
):
    allowed_targets = {"songlib", "plex", "fnos"}
    targets = list(dict.fromkeys(body.targets))
    if not targets or any(target not in allowed_targets for target in targets):
        raise HTTPException(status_code=400, detail="迁移目标无效")
    can_manage = user["role"] in ("owner", "admin") or "manage_library" in (user.get("permissions") or [])
    if ({"plex", "fnos"} & set(targets) or body.downloadMissing) and not can_manage:
        raise HTTPException(status_code=403, detail="同步媒体服务或下载缺失歌曲需要曲库管理权限")
    try:
        verified_preview = preview_share_link(
            body.sourceUrl,
            scopes=user.get("libraryScopes"),
        )
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=409, detail=f"歌单已无法重新验证：{exc}") from exc
    result = {"songlib": None, "plex": None, "fnos": None, "downloads": {"created": 0, "errors": []}}
    if "songlib" in targets:
        result["songlib"] = import_to_songlib(user["id"], verified_preview)
    if "plex" in targets:
        try:
            result["plex"] = export_to_plex(verified_preview)
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            result["plex"] = {"ok": False, "error": str(exc)}
    if "fnos" in targets:
        try:
            result["fnos"] = fnos_music.replace_playlist(
                verified_preview.get("name") or "SongLib 歌单",
                verified_preview.get("tracks") or [],
            )
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            result["fnos"] = {"ok": False, "error": str(exc)}
    if body.downloadMissing:
        if not body.sourceId:
            raise HTTPException(status_code=400, detail="请选择已启用的授权音乐源")
        source = get_source(body.sourceId)
        if not source_catalog_ready(source):
            raise HTTPException(status_code=409, detail="所选音乐源已停用或尚未识别到音乐接口")
        platform = "wy" if "wy" in (source.get("supportedPlatforms") or []) else ("tx" if "tx" in (source.get("supportedPlatforms") or []) else None)
        for track in [item for item in verified_preview.get("tracks") or [] if item.get("matchStatus") != "matched"][:200]:
            try:
                search = test_search(body.sourceId, f"{track.get('title', '')} {track.get('artist', '')}".strip(), platform)
                candidate = strict_candidate(track, search.get("results") or [])
                if not candidate:
                    raise ValueError("没有通过标题、艺人和时长校验的版本")
                payload = {"sourceId": body.sourceId, "quality": body.quality, "item": candidate}
                manager.create(
                    "download",
                    f"下载 {candidate.get('artist', '')} - {candidate.get('title', '')}",
                    payload,
                    idempotency_key=f"playlist-download:{verified_preview.get('platform')}:{track.get('platformTrackId')}:{body.quality}",
                )
                result["downloads"]["created"] += 1
            except Exception as exc:
                result["downloads"]["errors"].append({
                    "title": track.get("title"),
                    "artist": track.get("artist"),
                    "error": str(exc),
                })
    audit.record(
        user["id"],
        request.state.request_id,
        "playlist.migrate",
        "playlist",
        (result.get("songlib") or {}).get("id"),
        "success",
        {
            "platform": verified_preview.get("platform"),
            "targets": targets,
            "downloads": result["downloads"]["created"],
        },
    )
    return result


@app.get("/api/playlists/{playlist_id}")
def get_playlist(playlist_id: str, user=Depends(auth.current_user)):
    return playlist_service.get_playlist(playlist_id, user["id"], user["role"] in ("owner", "admin"))


@app.post("/api/playlists/{playlist_id}/sync")
def sync_playlist_to_services(
    playlist_id: str,
    body: PlaylistSyncBody,
    request: Request,
    user=Depends(auth.current_user),
):
    can_manage = user["role"] in ("owner", "admin") or "manage_library" in (user.get("permissions") or [])
    if not can_manage:
        raise HTTPException(status_code=403, detail="同步媒体服务歌单需要曲库管理权限")
    targets = list(dict.fromkeys(body.targets))
    if any(target not in {"plex", "fnos"} for target in targets):
        raise HTTPException(status_code=400, detail="同步目标无效")
    playlist = playlist_service.get_playlist(playlist_id, user["id"], user["role"] in ("owner", "admin"))
    matched = match_external_tracks(
        [
            {
                "title": item.get("title"),
                "artist": item.get("artist"),
                "album": item.get("album"),
                "duration": item.get("duration"),
                "externalRef": item.get("external_ref"),
            }
            for item in playlist.get("items") or []
        ],
        scopes=user.get("libraryScopes"),
    )
    tracks = []
    for source, item in zip(playlist.get("items") or [], matched):
        entity = item.get("localTrack") or {}
        resources = entity.get("resources") or []
        plex_key = next((resource.get("plexRatingKey") for resource in resources if resource.get("plexRatingKey")), None)
        external = str(source.get("external_ref") or "")
        if not plex_key and external.startswith("plex:"):
            plex_key = external.split(":", 1)[1]
        tracks.append({
            "title": source.get("title"),
            "artist": source.get("artist"),
            "album": source.get("album"),
            "duration": source.get("duration"),
            "plexRatingKey": plex_key,
        })
    preview = {"name": playlist["name"], "tracks": tracks}
    result = {}
    if "plex" in targets:
        try:
            result["plex"] = export_to_plex(preview)
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            result["plex"] = {"ok": False, "error": str(exc)}
    if "fnos" in targets:
        try:
            result["fnos"] = fnos_music.replace_playlist(playlist["name"], tracks)
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            result["fnos"] = {"ok": False, "error": str(exc)}
    audit.record(
        user["id"],
        request.state.request_id,
        "playlist.sync",
        "playlist",
        playlist_id,
        "success",
        {"targets": targets},
    )
    return result


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






STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static"))
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        target = STATIC_DIR / full_path
        if full_path and target.is_file() and STATIC_DIR in target.resolve().parents:
            headers = (
                {"Cache-Control": "no-store"}
                if target.name in {"sw.js", "manifest.json"}
                else None
            )
            return FileResponse(target, headers=headers)
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-store"},
        )
