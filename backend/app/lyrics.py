from __future__ import annotations

import re
from pathlib import Path

from .catalog import lyrics_for, search_netease, search_qq
from .db import get_kv, now, transaction
from .local_library import local_library
from .plex import local_media_path, plex


TIMED = re.compile(r"^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\].+", re.M)


def norm(value: str):
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", (value or "").lower())


def artist_match(candidate: str, wanted: str):
    a, b = norm(candidate), norm(wanted)
    if not a or not b:
        return False
    if a == b:
        return True
    parts = [norm(part) for part in re.split(r"[/、,&，]", candidate)]
    return b in parts or any(len(part) > 1 and (part in b or b in part) for part in parts)


def find_lyrics(track):
    title = track.get("title", "")
    artist = track.get("artist") or track.get("grandparentTitle") or track.get("originalTitle") or ""
    raw_duration = int(track.get("duration") or 0)
    duration = int(raw_duration / 1000) if raw_duration > 10000 else raw_duration
    candidates = []
    try:
        candidates.extend(search_qq(title))
    except Exception:
        pass
    try:
        candidates.extend(search_netease(title))
    except Exception:
        pass
    for item in candidates:
        if norm(item.get("title")) != norm(title):
            continue
        if not artist_match(item.get("artist", ""), artist):
            continue
        item_duration = int(item.get("duration") or 0)
        if duration and item_duration and abs(duration - item_duration) > 8:
            continue
        lyric = lyrics_for(item).replace("\r\n", "\n").strip()
        if len(TIMED.findall(lyric)) >= 3:
            return lyric + "\n", item["platform"]
    return "", ""


def fill_missing_lyrics(payload, progress):
    saved = (get_kv("ui_settings", {}) or {}).get("scrapeRules") or {}
    if saved.get("writeLyrics", True) is False:
        return {"missing": 0, "written": 0, "notFound": 0, "success": 0, "failed": 0, "skipped": 0, "errors": []}
    mode = payload.get("mode") or saved.get("defaultMode") or "missing"
    force = mode in ("refresh", "force")
    selected = {str(item.get("entityId")) for item in (payload.get("items") or []) if item.get("entityType") == "file" and item.get("fieldKey") == "lyrics" and item.get("action") != "skip"}
    candidates = []
    if selected:
        for file_id in selected:
            try:
                item = local_library.get(file_id)
                candidates.append({**item, "localPath": item["path"], "fileId": file_id, "duration": int(item.get("duration") or 0)})
            except KeyError:
                continue
    else:
        for track in plex.tracks():
            path = local_media_path(track.get("file", ""))
            if path and path.exists():
                track["localPath"] = str(path); candidates.append(track)
    pending = [item for item in candidates if force or not Path(item["localPath"]).with_suffix(".lrc").exists()]
    result = {"missing": len(pending), "written": 0, "notFound": 0, "errors": []}
    for index, track in enumerate(pending, 1):
        title = track.get("title", "")
        progress(
            int(index / max(1, len(pending)) * 95),
            f"正在查找歌词：{title} ({index}/{len(pending)})",
            index,
            len(pending),
        )
        try:
            lyric, source = find_lyrics(track)
            if not lyric:
                result["notFound"] += 1
                continue
            path = Path(track["localPath"]).with_suffix(".lrc")
            temp = path.with_name(path.name + ".pmm-tmp")
            temp.write_text(lyric, encoding="utf-8")
            temp.replace(path)
            with transaction() as conn:
                conn.execute("UPDATE files SET has_lrc=1,lyric_path=?,updated_at=? WHERE id=? OR path=?", (str(path), now(), track.get("fileId") or "", track.get("localPath")))
                if track.get("ratingKey"):
                    conn.execute("UPDATE plex_items SET has_lyrics=1,updated_at=? WHERE rating_key=?", (now(), str(track["ratingKey"])))
            result["written"] += 1
        except Exception as exc:
            result["errors"].append({"title": title, "error": str(exc)})
    if result["written"] and saved.get("refreshPlex", True):
        plex.scan()
    result.update(success=result["written"], failed=len(result["errors"]), skipped=result["notFound"])
    return result
