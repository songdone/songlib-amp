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
from .download_inbox import download_inbox
from .fnos_music import fnos_music
from .jobs import get_job, list_job_logs, list_jobs, manager
from .local_library import local_library, organizer
from .lyrics import find_lyrics
from .media_lyrics import read_local_lyrics
from .plex import dashboard_stats, local_artist_background_file, local_media_path, plex
from .scraper import build_diff_preview
from .security import SecurityMiddleware, client_key, issue_csrf, rate_limiter
from . import playlists as playlist_service
from .playlist_migration import export_to_plex, import_to_songlib, preview_share_link, strict_candidate
from . import recommendations as recommendation_service
from .unified_catalog import match_external_tracks, normalize as normalize_catalog_text, unified_tracks
from .sources import (
    SourceError, delete_source, get_source, import_code, import_file, import_url, list_sources,
    inspect_source, resolve_track, set_enabled, source_catalog_ready,
    source_logs, test_resolve, test_search,
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


class PlaylistSharePreviewBody(BaseModel):
    shareUrl: str = Field(min_length=10, max_length=2_000)


class PlaylistMigrationBody(BaseModel):
    sourceUrl: str = Field(min_length=10, max_length=2_000)
    targets: list[str] = Field(default_factory=lambda: ["songlib"], max_length=3)
    downloadMissing: bool = False
    sourceId: str | None = None
    quality: str = "320k"


class PlaylistSyncBody(BaseModel):
    targets: list[str] = Field(min_length=1, max_length=2)


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


class FnosSettingsBody(BaseModel):
    serverUrl: str
    authMode: str = Field(default="password", pattern="^(password|token)$")
    username: str = Field(default="", max_length=120)
    password: str = Field(default="", max_length=300)
    token: str = Field(default="", max_length=2_000)


class TagUpdateBody(BaseModel):
    changes: dict


class OrganizePreviewBody(BaseModel):
    fileIds: list[str]


class OrganizeApplyBody(BaseModel):
    previews: list[dict]


class DownloadInboxApplyBody(BaseModel):
    items: list[dict] = Field(min_length=1, max_length=2_000)


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
        raise RuntimeError("ï¼›".join(errors))
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
    database = {"ok": False, "message": "æ•°æ®åº“ä¸å¯ç”¨"}
    storage = {"ok": False, "message": "æ•°æ®ç›®å½•ä¸å¯å†™"}
    try:
        database = {"ok": bool(row("SELECT 1 AS value")), "message": "æ•°æ®åº“å¯ç”¨"}
    except Exception:
        pass
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        storage = {"ok": settings.data_dir.exists() and os.access(settings.data_dir, os.W_OK), "message": "æ•°æ®ç›®å½•å¯ç”¨"}
    except Exception:
        pass
    plex_config = plex.saved_settings()
    if not plex_config["enabled"]:
        plex_status = {"ok": True, "status": "disabled", "message": "Plex å·²åœç”¨"}
    elif not plex_config["serverUrl"]:
        plex_status = {"ok": True, "status": "not_configured", "message": "å°šæœªè¿æ¥ Plex"}
    else:
        try:
            plex.xml("/identity")
            plex_status = {"ok": True, "status": "connected", "message": "Plex å·²è¿æ¥"}
        except Exception:
            plex_status = {"ok": False, "status": "unavailable", "message": "Plex æš‚æ—¶ä¸å¯ç”¨"}
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
            "message": "åå°ä»»åŠ¡æœåŠ¡åœ¨çº¿" if worker_ok else "åå°ä»»åŠ¡æœåŠ¡å°šæœªä¸ŠæŠ¥çŠ¶æ€",
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
        raise HTTPException(status_code=409, detail="è¯·å…ˆå®Œæˆåˆå§‹è®¾ç½®")
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
            "localTracks": local.get("total", 0),Û]ºêÚ$z{-®éÜj×°¢'6W'f–6R#¢'ÆW‚"À¢&–B#¢Æ–Æ—7Eö–BÀ¢&—FV×2#¢°¢°¢¢¦—FVÒÀ¢'6÷W&6R#¢'ÆW…ö—FVÒ"À¢&'F—7B#¢—FVÒævWB‚&w&æG&VçEF—FÆR"’÷"—FVÒævWB‚&÷&–v–æÅF—FÆR"’÷"""À¢&Æ'VÒ#¢—FVÒævWB‚'&VçEF—FÆR"’÷"""À¢&6÷fW%W&Â#¢—FVÒævWB‚'F‡VÖ%W&Â"’÷"""À¢Ğ¢f÷"—FVÒ–â—FV×0¢–b—FVÒævWB‚'&F–æt¶W’"¢ÒÀ¢&—FVÔ6÷VçB#¢ÆVâ†—FV×2’À¢Ğ  ¤ç÷7B‚"ö’÷Æ–Æ—7G2"¦FVb7&VFU÷Æ–Æ—7B†&öG“¢Æ–Æ—7D&öG’Â&WVW7C¢&WVW7BÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢—FVÒÒÆ–Æ—7E÷6W'f–6Ræ7&VFU÷Æ–Æ—7B‡W6W%²&–B%ÒÂ&öG’ææÖRÂ&öG’æFW67&—F–öâÂ&öG’æ—FV×2¢VF—Bç&V6÷&B‡W6W%²&–B%ÒÂ&WVW7Bç7FFRç&WVW7Eö–BÂ'Æ–Æ—7Bæ7&VFR"Â'Æ–Æ—7B"Â—FVÕ²&–B%ÒÂ'7V66W72"Â²&—FVÔ6÷VçB#¢—FVÕ²&—FVÔ6÷VçB%×Ò¢&WGW&â—FVĞ  ¤ç÷7B‚"ö’÷Æ–Æ—7G2öÖ–w&FR÷&Wf–Wr"¦FVbÆ–Æ—7EöÖ–w&F–öå÷&Wf–Wr†&öG“¢Æ–Æ—7E6†&U&Wf–Wt&öG’ÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢G'“ ¢&W7VÇBÒ&Wf–Wu÷6†&UöÆ–æ²†&öG’ç6†&UW&ÂÂ66÷W3×W6W"ævWB‚&Æ–'&'•66÷W2"’¢6÷W&6W2Ò°¢²&–B#¢—FVÕ²&–B%ÒÂ&æÖR#¢—FVÒævWB‚&F—7Æ”æÖR"’÷"—FVÒævWB‚&æÖR"—Ğ¢f÷"—FVÒ–âÆ—7E÷6÷W&6W2‚¢–b6÷W&6Uö6FÆöu÷&VG’†—FVÒ¢Ğ¢&W7VÇE²&F÷væÆöE6÷W&6W2%ÒÒ6÷W&6W0¢&W7VÇE²'F&vWG2%ÒÒ°¢'6öævÆ–"#¢²&f–Æ&ÆR#¢G'VWÒÀ¢'ÆW‚#¢²&f–Æ&ÆR#¢&ööÂ‡ÆW‚ç6fVE÷6WGF–æw2‚’ævWB‚'6W'fW%W&Â"’—ÒÀ¢&fæ÷2#¢²&f–Æ&ÆR#¢fæ÷5ö×W6–2æ6öæf–wW&VGÒÀ¢Ğ¢&WGW&â&W7VÇ@¢W†6WBfÇVTW'&÷"2W†3 ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCÂFWF–Ã×7G"†W†2’’g&öÒW†0¢W†6WB‡GG‚ä…EEW'&÷"2W†3 ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓS"ÂFWF–ÃÖb.i¨.i{nizk9^Šû¾Xùn‹ùKŠ®jØÎXÙ^ûÉ§¶W†7Ò"’g&öÒW†0  ¤ç÷7B‚"ö’÷Æ–Æ—7G2öÖ–w&FRöW†V7WFR"¦FVbÆ–Æ—7EöÖ–w&F–öåöW†V7WFR€¢&öG“¢Æ–Æ—7DÖ–w&F–öä&öG’À¢&WVW7C¢&WVW7BÀ¢W6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’À¢“ ¢ÆÆ÷vVE÷F&vWG2Ò²'6öævÆ–""Â'ÆW‚"Â&fæ÷2'Ğ¢F&vWG2ÒÆ—7B†F–7Bæg&öÖ¶W—2†&öG’çF&vWG2’¢–bæ÷BF&vWG2÷"ç’‡F&vWBæ÷B–âÆÆ÷vVE÷F&vWG2f÷"F&vWB–âF&vWG2“ ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCÂFWF–ÃÒ.‹øz{¾yºîj~iziX‚"¢6åöÖævRÒW6W%²'&öÆR%Ò–â‚&÷væW""Â&FÖ–â"’÷"&ÖævUöÆ–'&'’"–â‡W6W"ævWB‚'W&Ö—76–öç2"’÷"µÒ¢–b‡²'ÆW‚"Â&fæ÷2'Òb6WB‡F&vWG2’÷"&öG’æF÷væÆöDÖ—76–ær’æBæ÷B6åöÖævS ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC2ÂFWF–ÃÒ.YÎjÚ^Z©.KÙ>iÈŞXªh‰nKˆ¾‹ÛŞ{Ë®ZKjØÎi».™ÈŠhi».[©>zêyniØ>™™"¢G'“ ¢fW&–f–VE÷&Wf–WrÒ&Wf–Wu÷6†&UöÆ–æ²€¢&öG’ç6÷W&6UW&ÂÀ¢66÷W3×W6W"ævWB‚&Æ–'&'•66÷W2"’À¢¢W†6WB…fÇVTW'&÷"Â‡GG‚ä…EEW'&÷"’2W†3 ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC’ÂFWF–ÃÖb.jØÎXÙ^[{.izk9^˜xŞikš¨ÎŠøûÉ§¶W†7Ò"’g&öÒW†0¢&W7VÇBÒ²'6öævÆ–"#¢æöæRÂ'ÆW‚#¢æöæRÂ&fæ÷2#¢æöæRÂ&F÷væÆöG2#¢²&7&VFVB#¢Â&W'&÷'2#¢µ××Ğ¢–b'6öævÆ–""–âF&vWG3 ¢&W7VÇE²'6öævÆ–"%ÒÒ–×÷'E÷Fõ÷6öævÆ–"‡W6W%²&–B%ÒÂfW&–f–VE÷&Wf–Wr¢–b'ÆW‚"–âF&vWG3 ¢G'“ ¢&W7VÇE²'ÆW‚%ÒÒW‡÷'E÷Fõ÷ÆW‚‡fW&–f–VE÷&Wf–Wr¢W†6WB…fÇVTW'&÷"Â'VçF–ÖTW'&÷"Â‡GG‚ä…EEW'&÷"’2W†3 ¢&W7VÇE²'ÆW‚%ÒÒ²&ö²#¢fÇ6RÂ&W'&÷"#¢7G"†W†2—Ğ¢–b&fæ÷2"–âF&vWG3 ¢G'“ ¢&W7VÇE²&fæ÷2%ÒÒfæ÷5ö×W6–2ç&WÆ6U÷Æ–Æ—7B€¢fW&–f–VE÷&Wf–WrævWB‚&æÖR"’÷"%6öætÆ–"jØÎXÙR"À¢fW&–f–VE÷&Wf–WrævWB‚'G&6·2"’÷"µÒÀ¢¢W†6WB…fÇVTW'&÷"Â'VçF–ÖTW'&÷"Â‡GG‚ä…EEW'&÷"’2W†3 ¢&W7VÇE²&fæ÷2%ÒÒ²&ö²#¢fÇ6RÂ&W'&÷"#¢7G"†W†2—Ğ¢–b&öG’æF÷væÆöDÖ—76–æs ¢–bæ÷B&öG’ç6÷W&6T–C ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCÂFWF–ÃÒ.Šû~˜hº[{.Y
şyJy¨NhèiØ>™û>K™k©"¢6÷W&6RÒvWE÷6÷W&6R†&öG’ç6÷W&6T–B¢–bæ÷B6÷W&6Uö6FÆöu÷&VG’‡6÷W&6R“ ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC’ÂFWF–ÃÒ.h˜˜™û>K™k©[{.XÎyJh‰n[	®iÊ®ŠønXŠ¾X‹™û>K™hê^Xú2"¢ÆFf÷&ÒÒ'w’"–b'w’"–â‡6÷W&6RævWB‚'7W÷'FVEÆFf÷&×2"’÷"µÒ’VÇ6R‚'G‚"–b'G‚"–â‡6÷W&6RævWB‚'7W÷'FVEÆFf÷&×2"’÷"µÒ’VÇ6RæöæR¢f÷"G&6²–â¶—FVÒf÷"—FVÒ–âfW&–f–VE÷&Wf–WrævWB‚'G&6·2"’÷"µÒ–b—FVÒævWB‚&ÖF6…7FGW2"’Ò&ÖF6†VB%Õ³£#Ó ¢G'“ ¢6V&6‚ÒFW7E÷6V&6‚†&öG’ç6÷W&6T–BÂb'·G&6²ævWB‚wF—FÆRrÂrr—Ò·G&6²ævWB‚v'F—7BrÂrr—Ò"ç7G&—‚’ÂÆFf÷&Ò¢6æF–FFRÒ7G&–7Eö6æF–FFR‡G&6²Â6V&6‚ævWB‚'&W7VÇG2"’÷"µÒ¢–bæ÷B6æF–FFS ¢&—6RfÇVTW'&÷"‚.k*iÈ˜	®‹ø~j~š)8ˆ›®K«®Y(Îi{n™[şj
š¨Îy¨Nx˜iÊÂ"¢–ÆöBÒ²'6÷W&6T–B#¢&öG’ç6÷W&6T–BÂ'VÆ—G’#¢&öG’çVÆ—G’Â&—FVÒ#¢6æF–FFWĞ¢ÖævW"æ7&VFR€¢&F÷væÆöB"À¢b.Kˆ¾‹ÛÒ¶6æF–FFRævWB‚v'F—7BrÂrr—ÒÒ¶6æF–FFRævWB‚wF—FÆRrÂrr—Ò"À¢–ÆöBÀ¢–FV×÷FVæ7•ö¶W“Öb'Æ–Æ—7BÖF÷væÆöC§·fW&–f–VE÷&Wf–WrævWB‚wÆFf÷&Òr—Ó§·G&6²ævWB‚wÆFf÷&ÕG&6´–Br—Ó§¶&öG’çVÆ—G—Ò"À¢¢&W7VÇE²&F÷væÆöG2%Õ²&7&VFVB%Ò³Ò¢W†6WBW†6WF–öâ2W†3 ¢&W7VÇE²&F÷væÆöG2%Õ²&W'&÷'2%ÒæVæB‡°¢'F—FÆR#¢G&6²ævWB‚'F—FÆR"’À¢&'F—7B#¢G&6²ævWB‚&'F—7B"’À¢&W'&÷"#¢7G"†W†2’À¢Ò¢VF—Bç&V6÷&B€¢W6W%²&–B%ÒÀ¢&WVW7Bç7FFRç&WVW7Eö–BÀ¢'Æ–Æ—7BæÖ–w&FR"À¢'Æ–Æ—7B"À¢‡&W7VÇBævWB‚'6öævÆ–""’÷"·Ò’ævWB‚&–B"’À¢'7V66W72"À¢°¢'ÆFf÷&Ò#¢fW&–f–VE÷&Wf–WrævWB‚'ÆFf÷&Ò"’À¢'F&vWG2#¢F&vWG2À¢&F÷væÆöG2#¢&W7VÇE²&F÷væÆöG2%Õ²&7&VFVB%ÒÀ¢ÒÀ¢¢&WGW&â&W7VÇ@  ¤ævWB‚"ö’÷Æ–Æ—7G2÷·Æ–Æ—7Eö–GÒ"¦FVbvWE÷Æ–Æ—7B‡Æ–Æ—7Eö–C¢7G"ÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢&WGW&âÆ–Æ—7E÷6W'f–6RævWE÷Æ–Æ—7B‡Æ–Æ—7Eö–BÂW6W%²&–B%ÒÂW6W%²'&öÆR%Ò–â‚&÷væW""Â&FÖ–â"’  ¤ç÷7B‚"ö’÷Æ–Æ—7G2÷·Æ–Æ—7Eö–GÒ÷7–æ2"¦FVb7–æ5÷Æ–Æ—7E÷Fõ÷6W'f–6W2€¢Æ–Æ—7Eö–C¢7G"À¢&öG“¢Æ–Æ—7E7–æ4&öG’À¢&WVW7C¢&WVW7BÀ¢W6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’À¢“ ¢6åöÖævRÒW6W%²'&öÆR%Ò–â‚&÷væW""Â&FÖ–â"’÷"&ÖævUöÆ–'&'’"–â‡W6W"ævWB‚'W&Ö—76–öç2"’÷"µÒ¢–bæ÷B6åöÖævS ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC2ÂFWF–ÃÒ.YÎjÚ^Z©.KÙ>iÈŞXªjØÎXÙ^™ÈŠhi».[©>zêyniØ>™™"¢F&vWG2ÒÆ—7B†F–7Bæg&öÖ¶W—2†&öG’çF&vWG2’¢–bç’‡F&vWBæ÷B–â²'ÆW‚"Â&fæ÷2'Òf÷"F&vWB–âF&vWG2“ ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCÂFWF–ÃÒ.YÎjÚ^yºîj~iziX‚"¢Æ–Æ—7BÒÆ–Æ—7E÷6W'f–6RævWE÷Æ–Æ—7B‡Æ–Æ—7Eö–BÂW6W%²&–B%ÒÂW6W%²'&öÆR%Ò–â‚&÷væW""Â&FÖ–â"’¢ÖF6†VBÒÖF6…öW‡FW&æÅ÷G&6·2€¢°¢°¢'F—FÆR#¢—FVÒævWB‚'F—FÆR"’À¢&'F—7B#¢—FVÒævWB‚&'F—7B"’À¢&Æ'VÒ#¢—FVÒævWB‚&Æ'VÒ"’À¢&GW&F–öâ#¢—FVÒævWB‚&GW&F–öâ"’À¢&W‡FW&æÅ&Vb#¢—FVÒævWB‚&W‡FW&æÅ÷&Vb"’À¢Ğ¢f÷"—FVÒ–âÆ–Æ—7BævWB‚&—FV×2"’÷"µĞ¢ÒÀ¢66÷W3×W6W"ævWB‚&Æ–'&'•66÷W2"’À¢¢G&6·2ÒµĞ¢f÷"6÷W&6RÂ—FVÒ–â¦—‡Æ–Æ—7BævWB‚&—FV×2"’÷"µÒÂÖF6†VB“ ¢VçF—G’Ò—FVÒævWB‚&Æö6ÅG&6²"’÷"·Ğ¢&W6÷W&6W2ÒVçF—G’ævWB‚'&W6÷W&6W2"’÷"µĞ¢ÆW…ö¶W’ÒæW‡B‚‡&W6÷W&6RævWB‚'ÆW…&F–æt¶W’"’f÷"&W6÷W&6R–â&W6÷W&6W2–b&W6÷W&6RævWB‚'ÆW…&F–æt¶W’"’’ÂæöæR¢W‡FW&æÂÒ7G"‡6÷W&6RævWB‚&W‡FW&æÅ÷&Vb"’÷"""¢–bæ÷BÆW…ö¶W’æBW‡FW&æÂç7F'G7v—F‚‚'ÆWƒ¢"“ ¢ÆW…ö¶W’ÒW‡FW&æÂç7Æ—B‚#¢"Â•³Ğ¢G&6·2æVæB‡°¢'F—FÆR#¢6÷W&6RævWB‚'F—FÆR"’À¢&'F—7B#¢6÷W&6RævWB‚&'F—7B"’À¢&Æ'VÒ#¢6÷W&6RævWB‚&Æ'VÒ"’À¢&GW&F–öâ#¢6÷W&6RævWB‚&GW&F–öâ"’À¢'ÆW…&F–æt¶W’#¢ÆW…ö¶W’À¢Ò¢&Wf–WrÒ²&æÖR#¢Æ–Æ—7E²&æÖR%ÒÂ'G&6·2#¢G&6·7Ğ¢&W7VÇBÒ·Ğ¢–b'ÆW‚"–âF&vWG3 ¢G'“ ¢&W7VÇE²'ÆW‚%ÒÒW‡÷'E÷Fõ÷ÆW‚‡&Wf–Wr¢W†6WB…fÇVTW'&÷"Â'VçF–ÖTW'&÷"Â‡GG‚ä…EEW'&÷"’2W†3 ¢&W7VÇE²'ÆW‚%ÒÒ²&ö²#¢fÇ6RÂ&W'&÷"#¢7G"†W†2—Ğ¢–b&fæ÷2"–âF&vWG3 ¢G'“ ¢&W7VÇE²&fæ÷2%ÒÒfæ÷5ö×W6–2ç&WÆ6U÷Æ–Æ—7B‡Æ–Æ—7E²&æÖR%ÒÂG&6·2¢W†6WB…fÇVTW'&÷"Â'VçF–ÖTW'&÷"Â‡GG‚ä…EEW'&÷"’2W†3 ¢&W7VÇE²&fæ÷2%ÒÒ²&ö²#¢fÇ6RÂ&W'&÷"#¢7G"†W†2—Ğ¢VF—Bç&V6÷&B€¢W6W%²&–B%ÒÀ¢&WVW7Bç7FFRç&WVW7Eö–BÀ¢'Æ–Æ—7Bç7–æ2"À¢'Æ–Æ—7B"À¢Æ–Æ—7Eö–BÀ¢'7V66W72"À¢²'F&vWG2#¢F&vWG7ÒÀ¢¢&WGW&â&W7VÇ@  ¤çF6‚‚"ö’÷Æ–Æ—7G2÷·Æ–Æ—7Eö–GÒ"¦FVbWFFU÷Æ–Æ—7B‡Æ–Æ—7Eö–C¢7G"Â&öG“¢Æ–Æ—7EF6„&öG’Â&WVW7C¢&WVW7BÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢—FVÒÒÆ–Æ—7E÷6W'f–6RçWFFU÷Æ–Æ—7B€¢Æ–Æ—7Eö–BÀ¢W6W%²&–B%ÒÀ¢æÖSÖ&öG’ææÖRÀ¢FW67&—F–öãÖ&öG’æFW67&—F–öâÀ¢—FV×3Ö&öG’æ—FV×2À¢¢VF—Bç&V6÷&B‡W6W%²&–B%ÒÂ&WVW7Bç7FFRç&WVW7Eö–BÂ'Æ–Æ—7BçWFFR"Â'Æ–Æ—7B"ÂÆ–Æ—7Eö–BÂ'7V66W72"Â²&—FVÔ6÷VçB#¢—FVÕ²&—FVÔ6÷VçB%×Ò¢&WGW&â—FVĞ  ¤æFVÆWFR‚"ö’÷Æ–Æ—7G2÷·Æ–Æ—7Eö–GÒ"¦FVbFVÆWFU÷Æ–Æ—7B‡Æ–Æ—7Eö–C¢7G"Â&WVW7C¢&WVW7BÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢Æ–Æ—7E÷6W'f–6RæFVÆWFU÷Æ–Æ—7B‡Æ–Æ—7Eö–BÂW6W%²&–B%Ò¢VF—Bç&V6÷&B‡W6W%²&–B%ÒÂ&WVW7Bç7FFRç&WVW7Eö–BÂ'Æ–Æ—7BæFVÆWFR"Â'Æ–Æ—7B"ÂÆ–Æ—7Eö–BÂ'7V66W72"¢&WGW&â²&ö²#¢G'VWĞ  ¤ç÷7B‚"ö’÷Æ–Æ—7G2ö–×÷'BöÓ7R"¦FVb–×÷'E÷Æ–Æ—7EöÓ7R†&öG“¢Ó5T–×÷'D&öG’Â&WVW7C¢&WVW7BÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢&W7VÇBÒÆ–Æ—7E÷6W'f–6Ræ–×÷'EöÓ7R‡W6W%²&–B%ÒÂ&öG’ææÖRÂ&öG’æ6öçFVçBÂ&öG’çF„Ö–æw2¢VF—Bç&V6÷&B€¢W6W%²&–B%ÒÀ¢&WVW7Bç7FFRç&WVW7Eö–BÀ¢'Æ–Æ—7Bæ–×÷'B"À¢'Æ–Æ—7B"À¢&W7VÇE²'Æ–Æ—7B%Õ²&–B%ÒÀ¢'7V66W72"À¢²&ÖF6†VB#¢&W7VÇE²&ÖF6†VB%ÒÂ'VæÖF6†VB#¢ÆVâ‡&W7VÇE²'VæÖF6†VB%Ò—ÒÀ¢¢&WGW&â&W7VÇ@  ¤ævWB‚"ö’÷Æ–Æ—7G2÷·Æ–Æ—7Eö–GÒöW‡÷'BæÓ7R"¦FVbW‡÷'E÷Æ–Æ—7EöÓ7R‡Æ–Æ—7Eö–C¢7G"ÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢æÖRÂ6öçFVçBÒÆ–Æ—7E÷6W'f–6RæW‡÷'EöÓ7R‡Æ–Æ—7Eö–BÂW6W%²&–B%Ò¢f–ÆVæÖRÒ&Rç7V"‡"%µåÇuÇSFSÕÇS–ffbâÕÒ²"Â%ò"ÂæÖR•³£Ò÷"'Æ–Æ—7B ¢&WGW&â&W7öç6R€¢6öçFVçCÖ6öçFVçBÀ¢ÖVF–÷G—SÒ&VF–ò÷‚Ö×VwW&Ã²6†'6WC×WFbÓ‚"À¢†VFW'3×²$6öçFVçBÔF—7÷6—F–öâ#¢bvGF6†ÖVçC²f–ÆVæÖSÒ'·V÷FR†f–ÆVæÖR—ÒæÓ7S‚"wÒÀ¢  ¤ç÷7B‚"ö’öÆ—7FVæ–æröWfVçG2"¦FVbÆ—7FVæ–æuöWfVçB†&öG“¢Æ—7FVæ–ætWfVçD&öG’ÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢&WGW&â&V6öÖÖVæFF–öå÷6W'f–6Rç&V6÷&EöWfVçB€¢W6W%²&–B%ÒÀ¢&öG’æWfVçEG—RÀ¢&öG’æf–ÆT–BÀ¢&öG’æW‡FW&æÅ&VbÀ¢&öG’ç÷6—F–öä×2À¢&öG’æGW&F–öä×2À¢&öG’æ6öçFW‡BÀ¢  ¤ævWB‚"ö’÷&V6öÖÖVæFF–öç2"¦FVb&V6öÖÖVæFF–öç2‡W6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢&WGW&â&V6öÖÖVæFF–öå÷6W'f–6RæÆ—7E÷&V6öÖÖVæFF–öç2‡W6W%²&–B%Ò  ¤ç÷7B‚"ö’÷&V6öÖÖVæFF–öç2÷&Vg&W6‚"¦FVb&Vg&W6…÷&V6öÖÖVæFF–öç2†&öG“¢&V6öÖÖVæFF–öå&Vg&W6„&öG’Â&WVW7C¢&WVW7BÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢&W7VÇBÒ&V6öÖÖVæFF–öå÷6W'f–6Rç&Vg&W6‚‡W6W%²&–B%ÒÂ&öG’æF—66÷fW&–W2Â&öG’æW‡Æ÷&F–öâ¢VF—Bç&V6÷&B€¢W6W%²&–B%ÒÀ¢&WVW7Bç7FFRç&WVW7Eö–BÀ¢'&V6öÖÖVæFF–öâç&Vg&W6‚"À¢'&öf–ÆR"À¢W6W%²&–B%ÒÀ¢'7V66W72"À¢²&6æF–FFT6÷VçB#¢ÆVâ‡&W7VÇE²&—FV×2%Ò’Â&W‡Æ÷&F–öâ#¢&öG’æW‡Æ÷&F–öçÒÀ¢¢&WGW&â&W7VÇ@  ¤ævWB‚"ö’öVF—BöWfVçG2"¦FVbVF—EöWfVçG2†Æ–Ö—C¢–çBÒVW'’†FVfVÇCÓÂvSÓÂÆSÓS’ÂW6W#ÔFWVæG2†WF‚æ7W'&VçE÷W6W"’“ ¢–bW6W%²'&öÆR%Òæ÷B–â‚&÷væW""Â&FÖ–â"“ ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC2ÂFWF–ÃÒ.Xú®iÈzêynYXúşKº^iú^yÈ¾ZêŠêŠë[ÙR"¢&WGW&â²&—FV×2#¢VF—BæÆ—7EöWfVçG2†Æ–Ö—B—Ğ Ğ Ğ¦FVbö&6·WöF—"‚’ÓâFƒ Ğ¢F—&V7F÷'’Ò6WGF–æw2æFFöF—"ò&&6·W2 Ğ¢F—&V7F÷'’æÖ¶F—"‡&VçG3ÕG'VRÂW†—7Eöö³ÕG'VRĞ¢&WGW&âF—&V7F÷'Ğ Ğ Ğ¦FVbö&6·W÷F‚†æÖS¢7G"’ÓâFƒ Ğ¢6fRÒF‚†æÖR’ææÖPĞ¢–b6fRÒæÖR÷"æ÷B&RægVÆÆÖF6‚‡"'6öævÆ–"ÕÆG³‡ÒÕÆG³gÕÂæF""Â6fR“ Ğ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCÂFWF–ÃÒ.ZH~K»Şih~K»nYŞiziX‚"Ğ¢&WGW&âö&6·WöF—"‚’ò6fPĞ Ğ Ğ¤ævWB‚"ö’ö&6·W2"ÂFWVæFVæ6–W3Õ´FWVæG2†WF‚æ7W'&VçE÷W6W"•ÒĞ¦FVbÆ—7Eö&6·W2‚“ Ğ¢—FV×2ÒµĞĞ¢f÷"F‚–â6÷'FVB…ö&6·WöF—"‚’ævÆö"‚'6öævÆ–"Ò¢æF""’Â&WfW'6SÕG'VR“ Ğ¢7FBÒF‚ç7FB‚Ğ¢—FV×2æVæB‡²&æÖR#¢F‚ææÖRÂ'6—¦R#¢7FBç7E÷6—¦RÂ&7&VFVDB#¢FFWF–ÖRæg&ö×F–ÖW7F×‡7FBç7Eö×F–ÖR’æ—6öf÷&ÖB‚—ÒĞ¢&WGW&â²&—FV×2#¢—FV×7ĞĞ Ğ Ğ¤ç÷7B‚"ö’ö&6·W2"ÂFWVæFVæ6–W3Õ´FWVæG2†WF‚æ7W'&VçE÷W6W"•ÒĞ¦FVb7&VFUö&6·W‚“ Ğ¢–bæ÷B6WGF–æw2æF%÷F‚æW†—7G2‚“ Ğ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCBÂFWF–ÃÒ.[Ù>X˜Şi[hÚî[©>KˆŞZÙYÊ‚"Ğ¢æÖRÒFFWF–ÖRææ÷r‚’ç7G&gF–ÖR‚'6öævÆ–"ÒU’VÒVBÒT‚TÒU2æF""Ğ¢F&vWBÒö&6·WöF—"‚’òæÖPĞ¢6÷W&6RÒ7Æ—FS2æ6öææV7B‡6WGF–æw2æF%÷F‚Ğ¢FW7F–æF–öâÒ7Æ—FS2æ6öææV7B‡F&vWBĞ¢G'“ ¢6÷W&6Ræ&6·W†FW7F–æF–öâ¢f–æÆÇ“ ¢FW7F–æF–öâæ6Æ÷6R‚¢6÷W&6Ræ6Æ÷6R‚¢F&vWBæ6†ÖöBƒóc¢&WGW&â²&ö²#¢G'VRÂ&—FVÒ#¢²&æÖR#¢æÖRÂ'6—¦R#¢F&vWBç7FB‚’ç7E÷6—¦RÂ&7&VFVDB#¢FFWF–ÖRææ÷r‚’æ—6öf÷&ÖB‚—×Ğ Ğ Ğ¤ævWB‚"ö’ö&6·W2÷¶æÖWÒöF÷væÆöB"ÂFWVæFVæ6–W3Õ´FWVæG2†WF‚æ7W'&VçE÷W6W"•ÒĞ¦FVbF÷væÆöEö&6·W†æÖS¢7G"“ Ğ¢F‚Òö&6·W÷F‚†æÖRĞ¢–bæ÷BF‚æW†—7G2‚“ Ğ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCBÂFWF–ÃÒ.ZH~K»ŞKˆŞZÙYÊ‚"Ğ¢&WGW&âf–ÆU&W7öç6R‡F‚Âf–ÆVæÖS×F‚ææÖRÂÖVF–÷G—SÒ&Æ–6F–öâ÷‚×7Æ—FS2"Ğ Ğ Ğ¤ç÷7B‚"ö’ö&6·W2÷¶æÖWÒ÷&W7F÷&R"ÂFWVæFVæ6–W3Õ´FWVæG2†WF‚æ7W'&VçE÷W6W"•ÒĞ¦FVb&W7F÷&Uö&6·W†æÖS¢7G"“ Ğ¢F‚Òö&6·W÷F‚†æÖRĞ¢–bæ÷BF‚æW†—7G2‚“ Ğ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓCBÂFWF–ÃÒ.ZH~K»ŞKˆŞZÙYÊ‚"Ğ¢6÷W&6RÒ7Æ—FS2æ6öææV7B‡F‚Ğ¢FW7F–æF–öâÒ7Æ—FS2æ6öææV7B‡6WGF–æw2æF%÷F‚Ğ¢G'“ Ğ¢6†V6²Ò6÷W&6RæW†V7WFR‚%$tÔ–çFVw&—G•ö6†V6²"’æfWF6†öæR‚Ğ¢–bæ÷B6†V6²÷"6†V6µ³ÒÒ&ö²# Ğ¢&—6R…EEW†6WF–öâ‡7FGW5ö6öFSÓC’ÂFWF–ÃÒ.ZH~K»ŞZèÎi[Nh
~j8iú^iÊ®˜	®‹ør"Ğ¢6÷W&6Ræ&6·W†FW7F–æF–öâĞ¢f–æÆÇ“ Ğ¢FW7F–æF–öâæ6Æ÷6R‚Ğ¢6÷W&6Ræ6Æ÷6R‚Ğ¢&WGW&â²&ö²#¢G'VRÂ'&W7F÷&VB#¢æÖRÂ&ÖW76vR#¢.ZH~K»Ş[{.h.ZHŞûÈÎŠû~˜xŞiky›¾[Ù^Kº^X‹~ikKÉ®ŠùŞ8"'ĞĞ Ğ Ğ¥5DD”5ôD•"ÒF‚†÷2ævWFVçb‚%5DD”5ôD•""Â"ö÷7FF–2"’Ğ¦–b5DD”5ôD•"æW†—7G2‚“ Ğ¢æÖ÷VçB‚"ö76WG2"Â7FF–4f–ÆW2†F—&V7F÷'“Õ5DD”5ôD•"ò&76WG2"’ÂæÖSÒ&76WG2"Ğ Ğ¢ævWB‚"÷¶gVÆÅ÷Fƒ§F‡Ò"¢FVb7†gVÆÅ÷Fƒ¢7G"“ ¢F&vWBÒ5DD”5ôD•"ògVÆÅ÷F€¢–bgVÆÅ÷F‚æBF&vWBæ—5öf–ÆR‚’æB5DD”5ôD•"–âF&vWBç&W6öÇfR‚’ç&VçG3 ¢†VFW'2Ò€¢²$66†RÔ6öçG&öÂ#¢&æò×7F÷&R'Ğ¢–bF&vWBææÖR–â²'7ræ§2"Â&Öæ–fW7Bæ§6öâ'Ğ¢VÇ6RæöæP¢¢&WGW&âf–ÆU&W7öç6R‡F&vWBÂ†VFW'3Ö†VFW'2¢&WGW&âf–ÆU&W7öç6R€¢5DD”5ôD•"ò&–æFW‚æ‡FÖÂ"À¢†VFW'3×²$66†RÔ6öçG&öÂ#¢&æò×7F÷&R'ÒÀ¢ 