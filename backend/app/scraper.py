from __future__ import annotations

import io
import json
import re
import unicodedata
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from PIL import Image
from mutagen import File as MutagenFile

from .config import settings
from .db import get_kv, now, row, transaction
from .local_library import local_library, organizer
from .plex import has_chinese, local_media_path, plex


HEADERS_QQ = {"User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com/"}
HEADERS_NE = {"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"}


def norm(value: str):
    value = unicodedata.normalize("NFKC", value or "").lower().replace("&", "and")
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)


def exact(candidate: str, wanted):
    return norm(candidate) in {norm(value) for value in wanted if value}


def get_json(url: str, headers):
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()


def get_bytes(url: str, headers):
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.content


def image_ok(data: bytes, background=False):
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
        return width >= 1200 and height >= 675 and width / height >= 1.55 if background else width >= 500 and height >= 500
    except Exception:
        return False


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".pmm-tmp")
    temp.write_bytes(data)
    temp.replace(path)


def _rules(payload: dict) -> dict:
    saved = (get_kv("ui_settings", {}) or {}).get("scrapeRules") or {}
    return {
        "mode": payload.get("mode") or saved.get("defaultMode") or "missing",
        "writeCover": saved.get("writeCover", True),
        "writeLyrics": saved.get("writeLyrics", True),
        "refreshPlex": saved.get("refreshPlex", True),
        "skipExistingCover": saved.get("skipExistingCover", True),
        "skipExistingLyrics": saved.get("skipExistingLyrics", True),
    }


def _planned_fields(payload: dict, rating_key: str) -> set[str] | None:
    items = payload.get("items")
    if not items:
        return None
    return {
        str(item.get("fieldKey") or "") for item in items
        if str(item.get("entityId") or "") == str(rating_key) and item.get("action") != "skip"
    }


def _save_plex_metadata(rating_key: str, item_type: str, title: str, section_key: str, **fields):
    allowed = {
        "artist_bio_zh", "album_description_zh", "metadata_source", "cover_path",
        "poster_path", "background_path", "has_cover", "has_background", "has_lyrics", "summary",
    }
    values = {key: value for key, value in fields.items() if key in allowed}
    stamp = now()
    item_id = uuid.uuid5(uuid.NAMESPACE_URL, "plex:" + str(rating_key)).hex
    with transaction() as conn:
        conn.execute(
            """INSERT INTO plex_items(id,rating_key,type,section_key,title,last_synced_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(rating_key) DO NOTHING""",
            (item_id, str(rating_key), item_type, str(section_key or ""), title, stamp, stamp, stamp),
        )
        if values:
            assignments = ",".join(f"{key}=?" for key in values)
            conn.execute(
                f"UPDATE plex_items SET {assignments},updated_at=? WHERE rating_key=?",
                (*values.values(), stamp, str(rating_key)),
            )


def _artist_dir(artist: dict) -> Path:
    try:
        local = local_media_path(plex.first_track(artist["ratingKey"]))
        if local:
            return settings.music_root / local.relative_to(settings.music_root).parts[0]
    except Exception:
        pass
    return settings.data_dir / "artists" / str(artist.get("ratingKey") or uuid.uuid4().hex)


def _embedded_cover(path: Path) -> bytes:
    try:
        audio = MutagenFile(path, easy=False)
        pictures = getattr(audio, "pictures", None)
        if pictures:
            return pictures[0].data
        for key, value in (getattr(audio, "tags", {}) or {}).items():
            if str(key).upper().startswith("APIC"):
                return value.data
            if str(key).lower() == "covr" and value:
                return bytes(value[0])
    except Exception:
        pass
    return b""


def match_artist(title: str, folder: str):
    wanted = [title, folder]
    qq_url = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&key=" + urllib.parse.quote(title)
    qq_items = get_json(qq_url, HEADERS_QQ).get("data", {}).get("singer", {}).get("itemlist", [])
    qq = next((item for item in qq_items if exact(item.get("name", ""), wanted)), None)
    if not qq and title == "信":
        qq = next((item for item in qq_items if item.get("id") == "6547"), None)
    ne_url = "https://music.163.com/api/search/get/web?s=" + urllib.parse.quote(title) + "&type=100&limit=10&offset=0"
    ne_items = get_json(ne_url, HEADERS_NE).get("result", {}).get("artists", [])
    ne = next((item for item in ne_items if exact(item.get("name", ""), wanted) or any(exact(alias, wanted) for alias in item.get("alias") or [])), None)
    return qq, ne


def qq_details(mid: str):
    url = (
        "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_singer_desc.fcg?singermid="
        + urllib.parse.quote(mid) + "&utf8=1&outCharset=utf-8&format=xml"
    )
    raw = get_bytes(url, HEADERS_QQ)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(raw)
    description = (root.findtext("./data/info/desc") or "").strip()
    basics = {}
    for item in root.findall("./data/info/basic/item"):
        key = (item.findtext("key") or "").strip()
        value = (item.findtext("value") or "").strip()
        if key and value:
            basics[key] = value
    return description[:1800], basics


def scrape_artists(payload: dict, progress):
    rules = _rules(payload)
    force = rules["mode"] in ("refresh", "force")
    artists = plex.artists()
    results = {"posters": 0, "backgrounds": 0, "bios": 0, "skipped": 0, "errors": []}
    for index, artist in enumerate(artists, 1):
        title = artist.get("title", "")
        progress(int(index / max(1, len(artists)) * 95), f"正在处理 {title} ({index}/{len(artists)})", index, len(artists))
        if title.lower() == "various artists":
            results["skipped"] += 1
            continue
        try:
            planned = _planned_fields(payload, artist["ratingKey"])
            if planned is not None and not planned:
                results["skipped"] += 1
                continue
            artist_dir = _artist_dir(artist)
            artist_dir.mkdir(parents=True, exist_ok=True)
            qq, ne = match_artist(title, artist_dir.name)
            fields = {"title.value": title, "title.locked": 1, "titleSort.value": artist.get("titleSort") or title, "titleSort.locked": 1}
            db_fields = {"metadata_source": "QQ音乐 / 网易云音乐"}
            if qq and qq.get("mid"):
                if (planned is None or "artist_poster" in planned) and (force or not artist.get("thumb") or not (artist_dir / "artist-poster.jpg").exists()):
                    poster = get_bytes(f"https://y.gtimg.cn/music/photo_new/T001R1500x1500M000{qq['mid']}.jpg", HEADERS_QQ)
                    if image_ok(poster):
                        poster_path = artist_dir / "artist-poster.jpg"
                        atomic_write(poster_path, poster)
                        plex.upload_poster(artist["ratingKey"], poster, section_key=artist.get("sectionKey"))
                        db_fields.update(poster_path=str(poster_path), has_cover=1)
                        results["posters"] += 1
                if planned is None or "artist_bio" in planned:
                    description, basics = qq_details(qq["mid"])
                    if has_chinese(description):
                        fields.update({"summary.value": description, "summary.locked": 1})
                        db_fields.update(artist_bio_zh=description, summary=description)
                        results["bios"] += 1
                    country = basics.get("国籍")
                    if country:
                        fields.update({"country.locked": 1, "country[0].tag.tag": country})
            if ne and (planned is None or "artist_background" in planned) and (force or not artist.get("art") or not (artist_dir / "artist-background.jpg").exists()):
                head = get_json(f"https://music.163.com/api/artist/head/info/get?id={ne['id']}", HEADERS_NE).get("data", {}).get("artist", {})
                cover_url = (head.get("cover") or ne.get("picUrl") or "").replace("http://", "https://")
                if cover_url:
                    joiner = "&" if "?" in cover_url else "?"
                    art = get_bytes(cover_url + joiner + "param=1920y1080", HEADERS_NE)
                    if image_ok(art, background=True):
                        atomic_write(artist_dir / "artist-background.jpg", art)
                        plex.upload_art(artist["ratingKey"], art, section_key=artist.get("sectionKey"))
                        db_fields.update(background_path=str(artist_dir / "artist-background.jpg"), has_background=1)
                        results["backgrounds"] += 1
            plex.edit(artist["ratingKey"], 8, fields, artist.get("sectionKey"))
            _save_plex_metadata(artist["ratingKey"], "artist", title, artist.get("sectionKey"), **db_fields)
        except Exception as exc:
            results["errors"].append({"artist": title, "error": str(exc)})
    results.update(success=results["posters"] + results["backgrounds"] + results["bios"], failed=len(results["errors"]))
    return results


def _album_match(title: str, artist: str):
    qq_url = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&key=" + urllib.parse.quote(title)
    qq_items = get_json(qq_url, HEADERS_QQ).get("data", {}).get("album", {}).get("itemlist", [])
    qq = next((item for item in qq_items if exact(item.get("name", ""), [title]) and exact(item.get("singer", ""), [artist])), None)
    qq_cover = get_bytes(f"https://y.gtimg.cn/music/photo_new/T002R1500x1500M000{qq['mid']}.jpg", HEADERS_QQ) if qq else b""
    ne_url = "https://music.163.com/api/search/get/web?s=" + urllib.parse.quote(title) + "&type=10&limit=15&offset=0"
    ne_items = get_json(ne_url, HEADERS_NE).get("result", {}).get("albums", [])
    ne = next((item for item in ne_items if exact(item.get("name", ""), [title]) and exact((item.get("artist") or {}).get("name", ""), [artist])), None)
    description = ""
    if ne and ne.get("id"):
        try:
            detail = get_json(f"https://music.163.com/api/album/{ne['id']}", HEADERS_NE).get("album", {})
            description = (detail.get("description") or detail.get("briefDesc") or "").strip()[:1800]
        except Exception:
            description = ""
    if image_ok(qq_cover):
        return qq_cover, "QQ音乐", description
    if ne and ne.get("picUrl"):
        return get_bytes(ne["picUrl"] + "?param=1500y1500", HEADERS_NE), "网易云音乐", description
    return b"", "", description


def fill_album_covers(payload: dict, progress):
    rules = _rules(payload)
    force = rules["mode"] in ("refresh", "force")
    albums = plex.albums()
    selected = [album for album in albums if _planned_fields(payload, album.get("ratingKey")) is None or _planned_fields(payload, album.get("ratingKey"))]
    results = {"missing": len(selected), "filled": 0, "descriptions": 0, "skipped": 0, "errors": []}
    for index, album in enumerate(selected, 1):
        progress(int(index / max(1, len(selected)) * 95), f"正在查找 {album.get('parentTitle')} - {album.get('title')}", index, len(selected))
        try:
            title = album.get("title", "")
            artist = album.get("parentTitle", "")
            if not title or not artist or artist.lower() == "various artists":
                results["skipped"] += 1
                continue
            track = plex.first_track(album["ratingKey"])
            local = local_media_path(track)
            album_dir = None
            if local:
                album_dir = local.parent
                if re.fullmatch(r"(?i)(cd|disc|disk)\s*\d+", album_dir.name):
                    album_dir = album_dir.parent
            planned = _planned_fields(payload, album["ratingKey"])
            wants_cover = planned is None or "album_cover" in planned
            wants_description = planned is None or "album_description" in planned
            local_cover = next((album_dir / name for name in ("cover.jpg", "folder.jpg", "front.jpg", "cover.png") if album_dir and (album_dir / name).exists()), None)
            data = local_cover.read_bytes() if local_cover else (_embedded_cover(local) if local and local.exists() else b"")
            source = "本地文件" if data else ""
            online_data, online_source, description = b"", "", ""
            if (wants_cover and (force or not album.get("thumb") or not data)) or wants_description:
                online_data, online_source, description = _album_match(title, artist)
            if wants_cover and (force or not album.get("thumb")):
                data = data if image_ok(data) else online_data
                source = source or online_source
                if image_ok(data):
                    cover_path = album_dir / "cover.jpg" if album_dir else settings.data_dir / "albums" / str(album["ratingKey"]) / "cover.jpg"
                    if rules["writeCover"] and (force or not cover_path.exists()): atomic_write(cover_path, data)
                    plex.upload_poster(album["ratingKey"], data, media_type=9, section_key=album.get("sectionKey"))
                    _save_plex_metadata(album["ratingKey"], "album", title, album.get("sectionKey"), cover_path=str(cover_path), metadata_source=source, has_cover=1)
                    results["filled"] += 1
                else:
                    results["skipped"] += 1
            if wants_description and has_chinese(description):
                plex.edit(album["ratingKey"], 9, {"summary.value": description, "summary.locked": 1}, album.get("sectionKey"))
                _save_plex_metadata(album["ratingKey"], "album", title, album.get("sectionKey"), album_description_zh=description, summary=description, metadata_source=online_source or source)
                results["descriptions"] += 1
        except Exception as exc:
            results["errors"].append({"album": album.get("title"), "error": str(exc)})
    results.update(success=results["filled"] + results["descriptions"], failed=len(results["errors"]))
    return results


def build_diff_preview(kind: str, scope: str = "missing", mode: str = "missing", limit: int = 100, scope_value: str = ""):
    """Create the exact item/field plan later consumed by the worker."""
    result = []
    force = mode in ("refresh", "force")
    rules = _rules({"mode": mode})
    needle = norm(scope_value)

    def scope_ok(entity_type: str, title: str, artist: str = "", path: str = "") -> bool:
        if scope in ("artist", "specific_artist"):
            return entity_type == "artist" and bool(needle) and needle in norm(title)
        if scope in ("album", "specific_album"):
            return entity_type == "album" and bool(needle) and needle in norm(f"{artist}{title}")
        if scope == "folder":
            return bool(scope_value) and scope_value.casefold() in path.casefold()
        if scope == "unknown":
            return "unknown" in f"{artist} {title}".casefold() or "未知" in f"{artist} {title}"
        return True

    def wants(field_key: str) -> bool:
        filters = {
            "missing_cover": {"album_cover"}, "missing_lyrics": {"lyrics"},
            "missing_background": {"artist_background"}, "missing_bio": {"artist_bio", "album_description"},
        }
        return field_key in filters.get(scope, {field_key})

    def append(*, entity_type, entity_id, section_key, target, field, field_key, exists, new_value, source, confidence, conflict=False, reason="", execution=None):
        if len(result) >= limit or not wants(field_key):
            return
        if exists and not force:
            return
        action = "skip" if reason else ("replace" if exists else "create")
        result.append({
            "id": uuid.uuid4().hex[:16], "entityType": entity_type, "entityId": str(entity_id),
            "sectionKey": str(section_key or ""), "target": target, "field": field, "fieldKey": field_key,
            "oldValue": "已有内容" if exists else "缺失", "newValue": new_value or "待匹配",
            "candidateSource": source, "confidence": round(float(confidence), 2), "conflict": bool(conflict),
            "action": action, "skipReason": reason, "execution": execution,
        })

    if kind in ("scrape_artists", "scrape_plex_metadata"):
        for artist in plex.artists():
            title = (artist.get("title") or "").strip()
            if not scope_ok("artist", title) or len(result) >= limit:
                continue
            if not title or title.casefold() == "various artists":
                append(entity_type="artist", entity_id=artist.get("ratingKey"), section_key=artist.get("sectionKey"), target=title or "未命名歌手", field="歌手资料", field_key="artist_bio", exists=False, new_value="不修改", source="—", confidence=0, reason="无法唯一识别歌手")
                continue
            directory = _artist_dir(artist)
            db_item = row("SELECT * FROM plex_items WHERE rating_key=?", (str(artist.get("ratingKey")),)) or {}
            for field, field_key, exists, target, source in (
                ("歌手海报", "artist_poster", bool(artist.get("thumb") or (directory / "artist-poster.jpg").exists()), str(directory / "artist-poster.jpg"), "QQ 音乐"),
                ("歌手背景", "artist_background", bool(artist.get("art") or (directory / "artist-background.jpg").exists()), str(directory / "artist-background.jpg"), "网易云音乐"),
                ("中文简介", "artist_bio", bool(db_item.get("artist_bio_zh") or has_chinese(artist.get("summary") or "")), "数据库 + Plex 简介", "QQ 音乐"),
            ):
                append(entity_type="artist", entity_id=artist.get("ratingKey"), section_key=artist.get("sectionKey"), target=title, field=field, field_key=field_key, exists=exists, new_value=target, source=source, confidence=.96, conflict=exists and force)

    if kind in ("fill_album_covers", "scrape_plex_metadata", "fill_assets"):
        for album in plex.albums():
            artist, title = album.get("parentTitle") or "", album.get("title") or "未命名专辑"
            if not scope_ok("album", title, artist) or len(result) >= limit:
                continue
            db_item = row("SELECT * FROM plex_items WHERE rating_key=?", (str(album.get("ratingKey")),)) or {}
            append(entity_type="album", entity_id=album.get("ratingKey"), section_key=album.get("sectionKey"), target=f"{artist} · {title}".strip(" ·"), field="专辑封面", field_key="album_cover", exists=bool(album.get("thumb") or db_item.get("cover_path")), new_value=f"{artist}/{title}/cover.jpg", source="本地封面 → 内嵌封面 → QQ 音乐 → 网易云音乐", confidence=.94 if artist else .58, conflict=bool(album.get("thumb") and force), reason="缺少专辑歌手" if not artist else "")
            if kind == "scrape_plex_metadata":
                append(entity_type="album", entity_id=album.get("ratingKey"), section_key=album.get("sectionKey"), target=f"{artist} · {title}".strip(" ·"), field="专辑中文简介", field_key="album_description", exists=bool(db_item.get("album_description_zh") or has_chinese(album.get("summary") or "")), new_value="数据库 + Plex 简介", source="网易云音乐", confidence=.82 if artist else .5, conflict=bool(db_item.get("album_description_zh") and force), reason="缺少专辑歌手" if not artist else "")

    if kind in ("fill_lyrics", "fill_assets"):
        data = local_library.list("", "", min(1000, max(limit * 5, 200)), 0)
        for item in data.get("items") or []:
            path = Path(item.get("path") or "")
            if not scope_ok("track", item.get("title") or path.stem, item.get("artist") or "", str(path)):
                continue
            reason = "设置已禁用写入歌词" if rules["writeLyrics"] is False else ("缺少歌手或标题" if not item.get("artist") or not item.get("title") else "")
            append(entity_type="file", entity_id=item.get("id"), section_key="", target=f"{item.get('artist')} · {item.get('title')}".strip(" ·"), field="歌词", field_key="lyrics", exists=bool(item.get("has_lrc")), new_value=str(path.with_suffix(".lrc")), source="QQ 音乐 → 网易云音乐", confidence=.92 if item.get("artist") and item.get("title") else .45, conflict=bool(item.get("has_lrc") and force), reason=reason)
            if len(result) >= limit: break

    if kind == "fill_local_tags":
        data = local_library.list("", "", min(1000, max(limit * 5, 200)), 0)
        for item in data.get("items") or []:
            if not scope_ok("file", item.get("title") or item.get("filename") or "", item.get("artist") or "", item.get("path") or ""):
                continue
            inferred = item.get("metadata_inferred") or {}
            missing = [key for key in ("artist", "album", "title", "album_artist") if inferred.get(key)]
            if not missing: continue
            append(entity_type="file", entity_id=item.get("id"), section_key="", target=item.get("filename") or item.get("title"), field=" / ".join(missing), field_key="local_tags", exists=False, new_value=f"{item.get('artist')} · {item.get('album')} · {item.get('title')}", source="目录结构", confidence=.82, reason="目录层级不足" if not item.get("artist") or not item.get("album") else "")
            if len(result) >= limit: break

    if kind == "local_organize":
        data = local_library.list(scope_value if scope == "folder" else "", "", min(1000, max(limit * 5, 200)), 0)
        for preview in organizer.preview([item["id"] for item in data.get("items") or []]):
            if preview["sourcePath"] == preview["targetPath"] and not preview.get("conflict"): continue
            append(entity_type="file", entity_id=preview.get("fileId"), section_key="", target=Path(preview["sourcePath"]).name, field="文件路径", field_key="organize", exists=False, new_value=preview["targetPath"], source="本地标签 + 命名规则", confidence=1, conflict=preview.get("conflict", False), reason="目标文件已存在" if preview.get("conflict") else "", execution=preview)
            if len(result) >= limit: break

    return {
        "id": uuid.uuid4().hex, "kind": kind, "scope": scope, "scopeValue": scope_value, "mode": mode,
        "createdAt": datetime.now(timezone.utc).isoformat(), "items": result,
        "summary": {
            "total": len(result), "create": sum(item["action"] == "create" for item in result),
            "replace": sum(item["action"] == "replace" for item in result), "skip": sum(item["action"] == "skip" for item in result),
            "conflicts": sum(bool(item["conflict"]) for item in result),
        },
        "truncated": len(result) >= limit,
    }
