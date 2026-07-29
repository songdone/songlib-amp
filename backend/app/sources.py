from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import secrets
import subprocess
import urllib.parse
import uuid
from pathlib import Path

import httpx

from .catalog import search as catalog_search
from .config import settings
from .db import now, row, rows, transaction
from .network import validate_public_url


HEADER_PATTERNS = {
    "name": re.compile(r"@name\s+([^\r\n*]+)"),
    "description": re.compile(r"@description\s+([^\r\n*]+)"),
    "version": re.compile(r"@version\s+([^\r\n*]+)"),
    "author": re.compile(r"@author\s+([^\r\n*]+)"),
}
QUALITY_ORDER = ("128k", "320k", "flac", "flac24bit")


class SourceError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def source_metadata(script: str) -> dict:
    result = {}
    for key, pattern in HEADER_PATTERNS.items():
        match = pattern.search(script[:10000])
        if match:
            result[key] = match.group(1).strip()
    return result


def _json(value, fallback):
    try:
        return json.loads(value or "")
    except (json.JSONDecodeError, TypeError):
        return fallback


def source_catalog_ready(source: dict) -> bool:
    if not source.get("enabled"):
        return False
    if source.get("searchOk") or source.get("search_ok"):
        return True
    inspection = source.get("inspectResult") or source.get("inspect_result") or {}
    methods = inspection.get("methods") or {}
    return bool(
        inspection.get("ok")
        and (inspection.get("catalog_search_adapter") or methods.get("search"))
    )


def source_download_capable(source: dict) -> bool:
    if not source.get("enabled"):
        return False
    if source.get("resolveOk") or source.get("resolve_ok"):
        return True
    inspection = source.get("inspectResult") or source.get("inspect_result") or {}
    return bool(inspection.get("ok") and (inspection.get("methods") or {}).get("resolve"))


def _decode(item: dict | None):
    if not item:
        return None
    for field, fallback in (("supported_platforms", []), ("supported_qualities", []), ("metadata", {}), ("inspect_result", {})):
        item[field] = _json(item.get(field), fallback)
    for field in ("enabled", "search_ok", "resolve_ok"):
        item[field] = bool(item.get(field))
    item["displayName"] = item.get("display_name") or item.get("name")
    item["sourceType"] = item.get("source_type")
    item["supportedPlatforms"] = item.get("supported_platforms")
    item["supportedQualities"] = item.get("supported_qualities")
    item["lastTestAt"] = item.get("last_test_at")
    item["lastErrorCode"] = item.get("last_error_code")
    item["lastErrorMessage"] = item.get("last_error_message")
    item["searchOk"] = item.get("search_ok")
    item["resolveOk"] = item.get("resolve_ok")
    item["detectedFormat"] = item.get("detected_format")
    item["inspectResult"] = item.get("inspect_result")
    item["successRate"] = item.get("success_rate") or 0
    item["catalogReady"] = source_catalog_ready(item)
    item["downloadCapable"] = source_download_capable(item)
    item.pop("stored_path", None)
    return item


def _auto_enable_legacy_validated_sources():
    candidates = rows("SELECT * FROM source_plugins WHERE enabled=0")
    for raw in candidates:
        source = _decode(raw)
        if not (source.get("inspectResult") or {}).get("ok"):
            continue
        explicitly_disabled = row(
            "SELECT 1 AS found FROM source_logs WHERE source_id=? AND action='disable' LIMIT 1",
            (source["id"],),
        )
        if explicitly_disabled:
            continue
        status = "inspect_ok" if source.get("detectedFormat") == "lx-event" else "partial"
        with transaction() as conn:
            conn.execute(
                "UPDATE source_plugins SET enabled=1,status=?,updated_at=? WHERE id=?",
                (status, now(), source["id"]),
            )
        add_log(
            source["id"],
            "info",
            "auto_enable",
            "升级后已将通过格式校验且未被手动禁用的音乐源设为启用。",
        )


def list_sources():
    _auto_enable_legacy_validated_sources()
    return [_decode(item) for item in rows("SELECT * FROM source_plugins ORDER BY created_at DESC")]


def get_source(source_id: str):
    item = _decode(row("SELECT * FROM source_plugins WHERE id=?", (str(source_id),)))
    if not item:
        raise SourceError("SOURCE_NOT_FOUND", "音乐源不存在。", 404)
    return item


def source_path(source: dict) -> Path:
    filename = Path(source["stored_filename"]).name
    path = (settings.source_dir / filename).resolve()
    if settings.source_dir.resolve() not in path.parents:
        raise SourceError("SOURCE_PATH_INVALID", "音乐源保存路径无效。")
    return path


def add_log(source_id: str, level: str, action: str, message: str, detail=None):
    with transaction() as conn:
        conn.execute(
            "INSERT INTO source_logs(id,source_id,level,action,message,detail,created_at) VALUES(?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, str(source_id), level, action, message,
             json.dumps(detail, ensure_ascii=False) if detail is not None else None, now()),
        )


def source_logs(source_id: str, limit: int = 100):
    get_source(source_id)
    result = rows("SELECT * FROM source_logs WHERE source_id=? ORDER BY created_at DESC LIMIT ?", (str(source_id), limit))
    for item in result:
        item["detail"] = _json(item.get("detail"), item.get("detail"))
    return result


def _max_source_bytes() -> int:
    return settings.source_max_size_mb * 1024 * 1024


def _validate_script_bytes(data: bytes) -> str:
    if not data:
        raise SourceError("SOURCE_FILE_EMPTY", "上传的音乐源文件为空。")
    if len(data) > _max_source_bytes():
        raise SourceError("SOURCE_FILE_TOO_LARGE", f"音乐源文件超过 {settings.source_max_size_mb} MB 大小限制。", 413)
    if b"\x00" in data[:4096]:
        raise SourceError("SOURCE_NOT_JAVASCRIPT", "文件包含二进制内容，不是 JavaScript 音乐源。")
    try:
        script = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SourceError("SOURCE_ENCODING_INVALID", "音乐源必须使用 UTF-8 编码。") from exc
    probe = script.lstrip()[:500].casefold()
    if probe.startswith(("<!doctype html", "<html", "<head", "<body")) or "<html" in probe:
        raise SourceError("SOURCE_URL_RETURNED_HTML", "该内容是 HTML 页面，不是 JS 音乐源文件。请使用 raw 原始 JS 地址。")
    return script


def _fetch_source_url(url: str) -> tuple[bytes, str]:
    if not url.strip():
        raise SourceError("SOURCE_URL_REQUIRED", "请输入音乐源 URL。")
    current = url.strip()
    try:
        with httpx.Client(timeout=httpx.Timeout(15, read=30), follow_redirects=False) as client:
            for _ in range(6):
                validate_public_url(current, label="音乐源 URL")
                response = client.get(current, headers={"User-Agent": "SongLib-Amp/0.2", "Accept": "application/javascript,text/javascript,text/plain,*/*"})
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise SourceError("SOURCE_URL_REDIRECT_INVALID", "音乐源 URL 重定向缺少目标地址。")
                    current = urllib.parse.urljoin(current, location)
                    continue
                if response.status_code != 200:
                    raise SourceError("SOURCE_URL_HTTP_ERROR", f"音乐源 URL 返回 HTTP {response.status_code}。")
                declared = int(response.headers.get("content-length") or 0)
                if declared > _max_source_bytes() or len(response.content) > _max_source_bytes():
                    raise SourceError("SOURCE_FILE_TOO_LARGE", f"音乐源文件超过 {settings.source_max_size_mb} MB 大小限制。", 413)
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type == "text/html":
                    raise SourceError("SOURCE_URL_RETURNED_HTML", "该链接返回的是 HTML 页面，不是 JS 音乐源文件。请使用 raw 原始 JS 地址。")
                return response.content, current
            raise SourceError("SOURCE_URL_TOO_MANY_REDIRECTS", "音乐源 URL 重定向次数过多。")
    except SourceError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError("SOURCE_URL_NOT_REACHABLE", f"音乐源 URL 无法访问：{exc}") from exc


def import_url(name: str, url: str):
    data, final_url = _fetch_source_url(url)
    return _persist_source(data, name=name, source_type="url", original_url=url, original_filename=Path(urllib.parse.urlparse(final_url).path).name or None)


def import_file(name: str, filename: str, content_type: str | None, data: bytes):
    if not filename:
        raise SourceError("SOURCE_FILE_REQUIRED", "请选择要上传的 .js 音乐源文件。")
    if Path(filename).suffix.casefold() != ".js":
        raise SourceError("SOURCE_FILE_EXTENSION_INVALID", "音乐源文件扩展名必须是 .js。")
    acceptable = {"application/javascript", "text/javascript", "application/x-javascript", "text/plain", "application/octet-stream", ""}
    mime = (content_type or "").split(";", 1)[0].lower()
    if mime not in acceptable:
        guessed = mimetypes.guess_type(filename)[0] or ""
        if guessed not in acceptable:
            raise SourceError("SOURCE_FILE_TYPE_INVALID", "上传文件的类型不是 JavaScript。")
    return _persist_source(data, name=name, source_type="file", original_filename=Path(filename).name)


def import_code(name: str, code: str):
    if not code or not code.strip():
        raise SourceError("SOURCE_CODE_EMPTY", "粘贴的音乐源源码为空。")
    return _persist_source(code.encode("utf-8"), name=name, source_type="code", original_filename="pasted-source.js")


def _persist_source(data: bytes, *, name: str, source_type: str, original_url=None, original_filename=None):
    script = _validate_script_bytes(data)
    encoded = script.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    duplicate = row("SELECT id FROM source_plugins WHERE file_sha256=?", (digest,))
    if duplicate:
        raise SourceError("SOURCE_DUPLICATE", "该音乐源已经导入，无需重复添加。", 409)
    source_id = uuid.uuid4().hex
    filename = f"source_{source_id}.js"
    path = settings.source_dir / filename
    path.write_bytes(encoded)
    metadata = source_metadata(script)
    display_name = (name or "").strip() or metadata.get("name") or "LX 自定义音乐源"
    stamp = now()
    with transaction() as conn:
        conn.execute(
            """INSERT INTO source_plugins(
              id,name,display_name,source_type,original_url,original_filename,stored_filename,stored_path,
              file_sha256,file_size,enabled,status,metadata,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (source_id, display_name, display_name, source_type, original_url, original_filename, filename,
             str(path), digest, len(encoded), 0, "unverified", json.dumps(metadata, ensure_ascii=False), stamp, stamp),
        )
    add_log(source_id, "info", "import", "音乐源文件已安全保存，开始隔离加载校验。")
    try:
        inspection = inspect_source(source_id)
        if not inspection["ok"]:
            return {"ok": False, "source": get_source(source_id), "error_code": "SOURCE_FORMAT_UNKNOWN", "message": inspection["message"]}
        return {
            "ok": True,
            "source": get_source(source_id),
            "inspection": inspection,
            "message": "音乐源已导入并默认启用，格式已通过隔离校验。",
        }
    except Exception as exc:
        error = _as_source_error(exc)
        _mark_error(source_id, error, action="validate")
        return {"ok": False, "source": get_source(source_id), "error_code": error.code, "message": error.message}


def _as_source_error(exc: Exception) -> SourceError:
    if isinstance(exc, SourceError):
        return exc
    message = str(exc)
    lowered = message.casefold()
    if "timeout" in lowered or "超时" in message:
        return SourceError("SOURCE_LOAD_TIMEOUT", "音乐源脚本加载超时，可能存在死循环或不兼容。")
    if "register request handler" in lowered:
        return SourceError("SOURCE_MISSING_RESOLVE_METHOD", "音乐源已保存，但没有检测到下载地址解析方法。")
    if "syntaxerror" in lowered:
        return SourceError("SOURCE_JAVASCRIPT_SYNTAX_ERROR", "音乐源存在 JavaScript 语法错误。")
    return SourceError("SOURCE_LOAD_FAILED", f"音乐源隔离加载失败：{message[:300]}")


def _inspect_path(path: Path) -> dict:
    inspector = Path(__file__).resolve().parents[1] / "source_inspector.mjs"
    node_binary = settings.resolved_node_binary
    if not node_binary:
        raise SourceError("SOURCE_RUNTIME_MISSING", "容器内没有 Node.js，无法检查音乐源格式。", 500)
    try:
        completed = subprocess.run(
            [node_binary, "--max-old-space-size=128", str(inspector), str(path)], stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=15, check=False,
            env={**os.environ, "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")},
        )
    except subprocess.TimeoutExpired as exc:
        raise SourceError("SOURCE_INSPECT_TIMEOUT", "音乐源格式检查超时，脚本可能包含死循环。") from exc
    if completed.returncode:
        detail = completed.stderr.decode("utf-8", "replace")[-1200:].strip()
        raise SourceError("SOURCE_INSPECT_FAILED", "音乐源格式检查失败：" + (detail or "未知错误"))
    try:
        return json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SourceError("SOURCE_INSPECT_RESULT_INVALID", "格式检查器返回了无法解析的数据。") from exc


def inspect_source(source_id: str):
    source = get_source(source_id)
    path = source_path(source)
    try:
        lx_data = _bridge(path, {"action": "__init__"})
        lx_info = lx_data.get("sourceInfo") or {}
        lx_sources = lx_info.get("sources") if isinstance(lx_info, dict) else {}
        if isinstance(lx_sources, dict) and lx_sources:
            result = {
                "ok": True, "detected_format": "lx-event", "export_type": "event-protocol",
                "top_level_keys": ["lx.EVENT_NAMES", "lx.on", "lx.send", "lx.request"], "global_keys": [],
                "methods": {
                    "search": False,
                    "resolve": any("musicUrl" in (item.get("actions") or []) for item in lx_sources.values() if isinstance(item, dict)),
                    "lyric": any("lyric" in (item.get("actions") or []) for item in lx_sources.values() if isinstance(item, dict)),
                    "cover": any("pic" in (item.get("actions") or []) for item in lx_sources.values() if isinstance(item, dict)),
                    "album": False, "playlist": False, "chart": False,
                },
                "compatibility": "full", "source_info": lx_info, "catalog_search_adapter": True,
                "load_error": None,
            }
        else:
            result = _inspect_path(path)
    except SourceError as lx_error:
        result = _inspect_path(path)
        if not result.get("ok") and not result.get("load_error"):
            result["load_error"] = lx_error.message
    source_info = result.get("source_info") or {}
    sources = source_info.get("sources") if isinstance(source_info, dict) else {}
    sources = sources if isinstance(sources, dict) else {}
    platforms = list(sources.keys())
    qualities = sorted(
        {quality for detail in sources.values() if isinstance(detail, dict) for quality in (detail.get("qualitys") or [])},
        key=lambda value: QUALITY_ORDER.index(value) if value in QUALITY_ORDER else 99,
    )
    methods = result.get("methods") or {}
    detected = result.get("detected_format") or "unknown"
    compatibility = result.get("compatibility") or "none"
    ok = bool(result.get("ok"))
    if detected == "lx-event" and methods.get("resolve"):
        status = "inspect_ok"
        message = "已识别为洛雪事件协议源；搜索由音屿目录适配器提供，下载地址由该源解析。"
    elif ok:
        status = "partial"
        message = f"已识别为 {detected}，但当前仅提供部分兼容能力。"
    else:
        status = "unavailable"
        message = "音乐源已加载，但没有检测到可识别的搜索或解析方法。"
    stamp = now()
    with transaction() as conn:
        conn.execute(
            """UPDATE source_plugins SET enabled=?,status=?,detected_format=?,compatibility=?,inspect_result=?,
            supported_platforms=?,supported_qualities=?,last_test_at=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?""",
            (1 if ok else 0, status, detected, compatibility, json.dumps(result, ensure_ascii=False), json.dumps(platforms, ensure_ascii=False),
             json.dumps(qualities, ensure_ascii=False), stamp, None if ok else "SOURCE_FORMAT_UNKNOWN",
             None if ok else message, stamp, str(source_id)),
        )
    add_log(source_id, "success" if ok else "error", "inspect", message, result)
    return {"ok": ok, "source_id": str(source_id), "detected_format": detected,
            "top_level_keys": result.get("top_level_keys") or [], "methods": methods,
            "compatibility": compatibility, "catalog_search_adapter": bool(result.get("catalog_search_adapter")),
            "supported_platforms": platforms, "supported_qualities": qualities, "message": message,
            "debug": {"export_type": result.get("export_type"), "global_keys": result.get("global_keys"), "load_error": result.get("load_error")}}


def _mark_error(
    source_id: str,
    error: SourceError,
    *,
    action: str,
    preserve_validation: bool = False,
):
    with transaction() as conn:
        status = "degraded" if preserve_validation else "unavailable"
        conn.execute(
            """UPDATE source_plugins SET status=?,success_rate=MAX(0,success_rate*0.8),last_test_at=?,
            last_error_code=?,last_error_message=?,updated_at=? WHERE id=?""",
            (status, now(), error.code, error.message, now(), str(source_id)),
        )
    add_log(source_id, "error", action, error.message, {"error_code": error.code})


def set_enabled(source_id: str, enabled: bool):
    source = get_source(source_id)
    inspected = bool((source.get("inspectResult") or {}).get("ok"))
    if enabled and not inspected:
        raise SourceError(
            "SOURCE_NOT_VALIDATED",
            "该音乐源尚未通过格式与安全校验，不能启用。",
        )
    status = source["status"] if enabled else "disabled"
    if enabled and source["resolve_ok"]:
        status = "resolve_ok"
    elif enabled and source["search_ok"]:
        status = "search_ok"
    elif enabled:
        status = (
            "inspect_ok"
            if source.get("detectedFormat") == "lx-event"
            else "partial"
        )
    with transaction() as conn:
        conn.execute("UPDATE source_plugins SET enabled=?,status=?,updated_at=? WHERE id=?", (1 if enabled else 0, status, now(), str(source_id)))
    add_log(source_id, "info", "enable" if enabled else "disable", "音乐源已启用。" if enabled else "音乐源已禁用。")
    return get_source(source_id)


def delete_source(source_id: str):
    source = get_source(source_id)
    path = source_path(source)
    with transaction() as conn:
        conn.execute("DELETE FROM source_plugins WHERE id=?", (str(source_id),))
        if str(source_id).startswith("legacy-") and str(source_id)[7:].isdigit():
            conn.execute("DELETE FROM sources WHERE id=?", (int(str(source_id)[7:]),))
    path.unlink(missing_ok=True)


def normalize_result(item: dict, source: dict):
    return {
        "sourceId": source["id"], "sourceName": source["displayName"], "platform": item.get("platform"),
        "trackId": str(item.get("id") or ""), "id": str(item.get("id") or ""), "title": item.get("title") or "",
        "artist": item.get("artist") or "", "album": item.get("album") or "", "duration": item.get("duration") or 0,
        "coverUrl": item.get("cover") or "", "cover": item.get("cover") or "", "qualities": item.get("qualities") or [],
        "musicInfo": item.get("musicInfo") or {}, "raw": item,
    }


def test_search(source_id: str, keyword: str, platform: str | None = None):
    source = get_source(source_id)
    if not keyword.strip():
        raise SourceError("SOURCE_TEST_KEYWORD_EMPTY", "请输入测试搜索关键词。")
    supported = source["supportedPlatforms"]
    selected = platform if platform in supported else next((value for value in ("tx", "wy") if value in supported), None)
    if not selected:
        error = SourceError("SOURCE_PLATFORM_UNSUPPORTED", "该音乐源没有声明 QQ 音乐或网易云平台支持。")
        _mark_error(
            source_id,
            error,
            action="test_search",
            preserve_validation=True,
        )
        raise error
    try:
        results = [normalize_result(item, source) for item in catalog_search(keyword, selected)]
        if not results:
            raise SourceError("SOURCE_SEARCH_EMPTY", "目录搜索没有返回结果，请换一个关键词重试。")
        stamp = now()
        next_status = "resolve_ok" if source["resolveOk"] else "search_ok"
        with transaction() as conn:
            conn.execute(
                """UPDATE source_plugins SET search_ok=1,status=?,success_rate=MAX(success_rate,50),last_test_at=?,last_success_at=?,
                last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?""",
                (next_status, stamp, stamp, stamp, str(source_id)),
            )
        add_log(source_id, "success", "test_search", f"测试搜索成功，返回 {len(results)} 条结果。", {"keyword": keyword, "platform": selected})
        return {"ok": True, "source_id": source_id, "platform": selected, "count": len(results), "results": results}
    except Exception as exc:
        error = _as_source_error(exc) if not isinstance(exc, (httpx.HTTPError,)) else SourceError("SOURCE_SEARCH_FAILED", f"测试搜索失败：{exc}")
        _mark_error(source_id, error, action="test_search")
        raise error


def resolve_track(source_id: str, track: dict, quality: str, *, require_enabled=False):
    source = get_source(source_id)
    if require_enabled and not source["enabled"]:
        raise SourceError("SOURCE_DISABLED", "音乐源未启用。")
    path = source_path(source)
    if not path.exists():
        raise SourceError("SOURCE_FILE_MISSING", "音乐源脚本文件缺失。")
    platform = track.get("platform") or (track.get("musicInfo") or {}).get("source")
    music_info = track.get("musicInfo") or (track.get("raw") or {}).get("musicInfo")
    if not platform or not isinstance(music_info, dict):
        raise SourceError("SOURCE_TRACK_INVALID", "歌曲数据不完整，无法请求音乐源解析。")
    payload = {"source": platform, "action": "musicUrl", "info": {"type": quality, "musicInfo": music_info}}
    data = _bridge(path, payload)
    result = data.get("result")
    if isinstance(result, str):
        url, headers = result, {}
    elif isinstance(result, dict):
        url, headers = result.get("url"), result.get("headers") or {}
    else:
        url, headers = None, {}
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise SourceError("SOURCE_RESOLVE_NO_URL", "音乐源没有返回有效的 HTTP(S) 下载地址。")
    try:
        validate_public_url(url, label="下载地址")
    except ValueError as exc:
        raise SourceError("SOURCE_RESOLVE_BLOCKED_URL", str(exc)) from exc
    return {"sourceId": source_id, "trackId": str(track.get("trackId") or track.get("id") or ""), "quality": quality,
            "url": url, "headers": headers, "sourceInfo": data.get("sourceInfo") or {}}


def _probe_audio(resolved: dict):
    current = resolved["url"]
    headers = {"User-Agent": "Mozilla/5.0", "Range": "bytes=0-4095", **(resolved.get("headers") or {})}
    max_bytes = settings.max_download_mb * 1024 * 1024
    try:
        with httpx.Client(timeout=httpx.Timeout(15, read=25), follow_redirects=False) as client:
            for _ in range(6):
                validate_public_url(current, label="下载地址")
                with client.stream("GET", current, headers=headers) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise SourceError("SOURCE_RESOLVE_REDIRECT_INVALID", "下载地址重定向缺少目标。")
                        current = urllib.parse.urljoin(current, location)
                        continue
                    if response.status_code not in (200, 206):
                        raise SourceError("SOURCE_RESOLVE_URL_UNREACHABLE", f"下载地址返回 HTTP {response.status_code}。")
                    content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                    size = int(response.headers.get("content-length") or 0)
                    if size > max_bytes:
                        raise SourceError("SOURCE_RESOLVE_FILE_TOO_LARGE", f"音频文件超过 {settings.max_download_mb} MB 限制。")
                    first = next(response.iter_bytes(4096), b"")
                    looks_audio = content_type.startswith("audio/") or content_type in ("application/octet-stream", "binary/octet-stream")
                    if not looks_audio and first.lstrip().startswith((b"<html", b"<!DOCTYPE", b"{")):
                        raise SourceError("SOURCE_RESOLVE_NOT_AUDIO", "源返回的是网页或 JSON，不是音频文件。")
                    if not first:
                        raise SourceError("SOURCE_RESOLVE_EMPTY", "下载地址没有返回音频数据。")
                    return {"url": current, "contentType": content_type or "unknown", "size": size or None, "sampleBytes": len(first)}
            raise SourceError("SOURCE_RESOLVE_TOO_MANY_REDIRECTS", "下载地址重定向次数过多。")
    except SourceError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError("SOURCE_RESOLVE_URL_UNREACHABLE", f"源返回的下载地址无法访问：{exc}") from exc


def _record_resolve_success(source_id: str, quality: str, probe: dict, action: str):
    stamp = now()
    source = get_source(source_id)
    qualities = sorted(
        set(source["supportedQualities"] + [quality]),
        key=lambda value: QUALITY_ORDER.index(value)
        if value in QUALITY_ORDER
        else 99,
    )
    with transaction() as conn:
        conn.execute(
            """UPDATE source_plugins SET resolve_ok=1,search_ok=1,status='resolve_ok',success_rate=100,supported_qualities=?,
            last_test_at=?,last_success_at=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?""",
            (
                json.dumps(qualities, ensure_ascii=False),
                stamp,
                stamp,
                stamp,
                str(source_id),
            ),
        )
    add_log(
        source_id,
        "success",
        action,
        f"{quality} 下载地址解析与音频探测成功。",
        probe,
    )


def test_resolve(source_id: str, track: dict, quality: str):
    try:
        resolved = resolve_track(source_id, track, quality)
        probe = _probe_audio(resolved)
        _record_resolve_success(source_id, quality, probe, "test_resolve")
        safe_result = {key: value for key, value in resolved.items() if key != "url"}
        safe_result.update(probe)
        return {"ok": True, "message": "下载地址解析可用。", "resolved": safe_result, "source": get_source(source_id)}
    except Exception as exc:
        error = _as_source_error(exc)
        _mark_error(source_id, error, action="test_resolve")
        raise error


def preflight_download(source_id: str, track: dict, quality: str):
    source = get_source(source_id)
    if not source_download_capable(source):
        raise SourceError(
            "SOURCE_NOT_DOWNLOAD_READY",
            "该音乐源尚未启用，或格式检查未识别到下载地址解析能力。",
        )
    resolved = resolve_track(source_id, track, quality, require_enabled=True)
    probe = _probe_audio(resolved)
    _record_resolve_success(source_id, quality, probe, "download_preflight")
    return {"contentType": probe["contentType"], "size": probe["size"], "sampleBytes": probe["sampleBytes"]}


def validate_source(script_path: Path):
    data = _bridge(script_path, {"action": "__init__"})
    source_info = data.get("sourceInfo") or {}
    if not isinstance(source_info.get("sources"), dict) or not source_info["sources"]:
        raise SourceError("SOURCE_INCOMPATIBLE_FORMAT", "音乐源已保存，但没有声明可用平台或下载地址解析能力。")
    return source_info


def _bridge(script_path: Path, payload: dict):
    bridge = Path(__file__).resolve().parents[1] / "lx_bridge.mjs"
    node_binary = settings.resolved_node_binary
    if not node_binary:
        raise SourceError("SOURCE_RUNTIME_MISSING", "容器内没有 Node.js，无法运行音乐源。", 500)
    try:
        completed = subprocess.run(
            [node_binary, "--max-old-space-size=128", str(bridge), str(script_path)],
            input=json.dumps(payload, ensure_ascii=False).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=settings.source_timeout_seconds, check=False,
            env={
                **os.environ,
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "ALLOW_PROXY_FAKE_IPS": "true" if settings.allow_proxy_fake_ips else "false",
            },
        )
    except subprocess.TimeoutExpired as exc:
        raise SourceError("SOURCE_LOAD_TIMEOUT", "音乐源脚本执行超时。") from exc
    if completed.returncode:
        error = completed.stderr.decode("utf-8", "replace")[-1500:].strip()
        if "private or reserved network is blocked" in error:
            matches = re.findall(r"Error:\s*source request to private or reserved network is blocked:\s*([^\n]+)", error)
            detail = f"（{matches[-1][:180]}）" if matches else ""
            raise SourceError("SOURCE_REQUEST_BLOCKED_URL", f"音乐源脚本尝试访问内网或保留地址，已被安全策略拦截{detail}。")
        if "too many redirects" in error:
            raise SourceError("SOURCE_REQUEST_TOO_MANY_REDIRECTS", "音乐源网络请求重定向次数过多。")
        messages = [item.strip() for item in re.findall(r"^Error:\s*([^\n]+)", error, flags=re.MULTILINE) if item.strip()]
        concise = messages[-1] if messages else (error.splitlines()[-1] if error else "未知错误")
        code = "SOURCE_UPSTREAM_FAILED" if concise in ("get music url failed", "internal server error", "too many requests", "block ip") else "SOURCE_EXECUTION_FAILED"
        raise SourceError(code, "音乐源上游返回错误：" + concise[:300])
    if len(completed.stdout) > 5 * 1024 * 1024:
        raise SourceError("SOURCE_RESULT_TOO_LARGE", "音乐源返回数据超过安全限制。")
    try:
        return json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SourceError("SOURCE_RESULT_INVALID", "音乐源返回了无法解析的数据。") from exc


# Compatibility aliases used by older call sites.
def add_source(name: str, url: str):
    return import_url(name, url)


def run_source(source_id: str, platform: str, music_info: dict, quality: str):
    result = resolve_track(str(source_id), {"platform": platform, "musicInfo": music_info}, quality, require_enabled=True)
    return result["url"], result.get("sourceInfo") or {}
