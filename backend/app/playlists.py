from __future__ import annotations

import json
import re
import uuid
from pathlib import PurePosixPath

from fastapi import HTTPException

from .db import now, row, rows, transaction


def _decode_playlist(item: dict | None):
    if not item:
        return None
    item["itemCount"] = int(item.pop("item_count", item.get("itemCount", 0)) or 0)
    return item


def list_playlists(user_id: str, include_all: bool = False):
    where = "" if include_all else "WHERE p.owner_id=?"
    params = () if include_all else (user_id,)
    return [
        _decode_playlist(item)
        for item in rows(
            f"""SELECT p.*,COUNT(i.id) AS item_count FROM playlists p
                LEFT JOIN playlist_items i ON i.playlist_id=p.id
                {where} GROUP BY p.id ORDER BY p.updated_at DESC""",
            params,
        )
    ]


def get_playlist(playlist_id: str, user_id: str, can_manage_all: bool = False):
    item = row("SELECT * FROM playlists WHERE id=?", (playlist_id,))
    if not item:
        raise HTTPException(status_code=404, detail="歌单不存在")
    if item["owner_id"] != user_id and not can_manage_all:
        raise HTTPException(status_code=403, detail="无权访问这个歌单")
    items = rows("SELECT * FROM playlist_items WHERE playlist_id=? ORDER BY position", (playlist_id,))
    item["items"] = items
    item["itemCount"] = len(items)
    return item


def create_playlist(user_id: str, name: str, description: str = "", items: list[dict] | None = None):
    name = (name or "").strip()
    if not name or len(name) > 120:
        raise HTTPException(status_code=400, detail="歌单名称需要 1-120 个字符")
    playlist_id = uuid.uuid4().hex
    stamp = now()
    try:
        with transaction() as conn:
            conn.execute(
                """INSERT INTO playlists(id,owner_id,name,description,created_at,updated_at)
                   VALUES(?,?,?,?,?,?)""",
                (playlist_id, user_id, name, (description or "").strip()[:500], stamp, stamp),
            )
            _replace_items(conn, playlist_id, items or [])
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            raise HTTPException(status_code=409, detail="已有同名歌单") from exc
        raise
    return get_playlist(playlist_id, user_id)


def update_playlist(playlist_id: str, user_id: str, *, name: str | None = None, description: str | None = None, items: list[dict] | None = None):
    current = get_playlist(playlist_id, user_id)
    next_name = (name if name is not None else current["name"]).strip()
    if not next_name or len(next_name) > 120:
        raise HTTPException(status_code=400, detail="歌单名称需要 1-120 个字符")
    next_description = (description if description is not None else current["description"]).strip()[:500]
    with transaction() as conn:
        conn.execute(
            "UPDATE playlists SET name=?,description=?,updated_at=? WHERE id=?",
            (next_name, next_description, now(), playlist_id),
        )
        if items is not None:
            conn.execute("DELETE FROM playlist_items WHERE playlist_id=?", (playlist_id,))
            _replace_items(conn, playlist_id, items)
    return get_playlist(playlist_id, user_id)


def delete_playlist(playlist_id: str, user_id: str):
    get_playlist(playlist_id, user_id)
    with transaction() as conn:
        conn.execute("DELETE FROM playlists WHERE id=?", (playlist_id,))


def _replace_items(conn, playlist_id: str, items: list[dict]):
    if len(items) > 20_000:
        raise HTTPException(status_code=400, detail="单个歌单最多包含 20000 首歌曲")
    stamp = now()
    seen: set[str] = set()
    for position, raw in enumerate(items):
        file_id = str(raw.get("fileId") or raw.get("file_id") or "").strip() or None
        external_ref = str(raw.get("externalRef") or raw.get("external_ref") or "").strip() or None
        identity = file_id or external_ref or "|".join(
            str(raw.get(key) or "").casefold().strip() for key in ("title", "artist", "album")
        )
        if identity in seen:
            continue
        seen.add(identity)
        file_item = conn.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone() if file_id else None
        conn.execute(
            """INSERT INTO playlist_items(
                 id,playlist_id,position,file_id,title,artist,album,duration,path,external_ref,match_status,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                uuid.uuid4().hex,
                playlist_id,
                len(seen) - 1,
                file_id if file_item else None,
                str((file_item["title"] if file_item else raw.get("title")) or "")[:300],
                str((file_item["artist"] if file_item else raw.get("artist")) or "")[:300],
                str((file_item["album"] if file_item else raw.get("album")) or "")[:300],
                int((file_item["duration"] if file_item else raw.get("duration")) or 0),
                str((file_item["path"] if file_item else raw.get("path")) or "")[:2000] or None,
                external_ref,
                "matched" if file_item else ("linked" if external_ref else "unmatched"),
                stamp,
            ),
        )


def import_m3u(user_id: str, name: str, content: str, path_mappings: list[dict] | None = None):
    if len(content.encode("utf-8")) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="歌单文件不能超过 2 MB")
    mappings = sorted(path_mappings or [], key=lambda item: len(str(item.get("source") or "")), reverse=True)
    pending: dict = {}
    parsed: list[dict] = []
    for raw_line in content.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line or line == "#EXTM3U":
            continue
        if line.startswith("#EXTINF:"):
            match = re.match(r"#EXTINF:(-?\d+),(?:(.*?)\s+-\s+)?(.*)", line)
            if match:
                pending = {"duration": max(0, int(match.group(1))), "artist": match.group(2) or "", "title": match.group(3) or ""}
            continue
        if line.startswith("#"):
            continue
        mapped = line.replace("\\", "/")
        for mapping in mappings:
            source = str(mapping.get("source") or "").replace("\\", "/").rstrip("/")
            target = str(mapping.get("target") or "").replace("\\", "/").rstrip("/")
            if source and (mapped == source or mapped.startswith(source + "/")):
                mapped = target + mapped[len(source):]
                break
        file_item = row("SELECT * FROM files WHERE path=?", (mapped,))
        if not file_item:
            filename = PurePosixPath(mapped).name
            file_item = row("SELECT * FROM files WHERE filename=? LIMIT 1", (filename,))
        parsed.append(
            {
                **pending,
                "fileId": file_item["id"] if file_item else None,
                "title": (file_item or {}).get("title") or pending.get("title") or PurePosixPath(mapped).stem,
                "artist": (file_item or {}).get("artist") or pending.get("artist") or "",
                "album": (file_item or {}).get("album") or "",
                "path": mapped,
            }
        )
        pending = {}
    playlist = create_playlist(user_id, name, f"从 M3U 导入，共 {len(parsed)} 条", parsed)
    unmatched = [item for item in playlist["items"] if item["match_status"] != "matched"]
    return {"playlist": playlist, "matched": len(parsed) - len(unmatched), "unmatched": unmatched}


def export_m3u(playlist_id: str, user_id: str):
    playlist = get_playlist(playlist_id, user_id)
    lines = ["#EXTM3U"]
    for item in playlist["items"]:
        lines.append(f"#EXTINF:{int(item.get('duration') or -1)},{item.get('artist') or ''} - {item.get('title') or ''}")
        lines.append(item.get("path") or f"songlib://{item.get('file_id') or item.get('external_ref') or item['id']}")
    return playlist["name"], "\n".join(lines) + "\n"
