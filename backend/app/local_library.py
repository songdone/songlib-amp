from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.apev2 import APEv2
from mutagen.asf import ASFTags
from mutagen.id3 import ID3, TALB, TCON, TDRC, TIT2, TPE1, TPE2, TPOS, TRCK

from .config import settings
from .db import get_kv, now, row, rows, set_kv, transaction
from .downloader import safe_name
from .plex import has_chinese, local_media_path, plex


AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".mp4", ".aac", ".ogg", ".opus", ".wav", ".ape", ".wma"}
IGNORED_DIRS = {"_incoming", "_downloads", ".trash", "@eaDir", "#recycle", ".snapshot"}
TAG_NAMES = ("title", "artist", "album", "albumartist", "date", "tracknumber", "discnumber", "genre")
ID3_TAGS = {
    "title": ("TIT2", TIT2),
    "artist": ("TPE1", TPE1),
    "album": ("TALB", TALB),
    "albumartist": ("TPE2", TPE2),
    "date": ("TDRC", TDRC),
    "tracknumber": ("TRCK", TRCK),
    "discnumber": ("TPOS", TPOS),
    "genre": ("TCON", TCON),
}
ASF_TAGS = {
    "title": "Title",
    "artist": "Author",
    "album": "WM/AlbumTitle",
    "albumartist": "WM/AlbumArtist",
    "date": "WM/Year",
    "tracknumber": "WM/TrackNumber",
    "discnumber": "WM/PartOfSet",
    "genre": "WM/Genre",
}
APE_TAGS = {
    "title": "Title",
    "artist": "Artist",
    "album": "Album",
    "albumartist": "Album Artist",
    "date": "Year",
    "tracknumber": "Track",
    "discnumber": "Disc",
    "genre": "Genre",
}


def clean_track_title(value: str, artist: str = "", album: str = "") -> str:
    """Normalize filenames and weak tags before anything reaches the UI."""
    title = Path(str(value or "")).stem
    title = re.sub(r"^\s*(?:cd\s*)?\d{1,3}(?:[-_.、\s]+)", "", title, flags=re.I)
    title = re.sub(r"\s*[-_.\s]+(?:official\s*)?(?:music\s*)?(?:video|mv)\s*$", "", title, flags=re.I)
    title = re.sub(r"\s*\[(?:mqms2|hi-?res|flac|320k|128k|official|无损|高品|mq)\]\s*", " ", title, flags=re.I)
    title = re.sub(r"\s+", " ", title).strip(" -_.")
    parts = [part.strip() for part in re.split(r"\s+-\s+", title) if part.strip()]
    if len(parts) == 2:
        left, right = parts
        if _norm(left) == _norm(right):
            title = left
        elif artist and _norm(left) == _norm(artist):
            title = right
        elif album and _norm(left) == _norm(album) and _norm(right).startswith(_norm(left)):
            title = right
    return title or "未命名歌曲"


def _norm(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value or "").casefold())


def infer_path_metadata(path: Path) -> dict:
    """Infer only missing metadata from the canonical Artist/Album/Track path."""
    try:
        relative = path.resolve().relative_to(settings.music_root.resolve())
        parts = [part for part in relative.parts if part not in IGNORED_DIRS]
    except Exception:
        parts = list(path.parts[-3:])
    artist = parts[0].strip() if len(parts) >= 3 else ""
    album_folder = parts[-2].strip() if len(parts) >= 2 else ""
    album = re.sub(r"\s*[（(](?:19|20)\d{2}[)）]\s*$", "", album_folder).strip()
    title = clean_track_title(path.stem, artist=artist, album=album)
    return {"title": title, "artist": artist, "album": album, "album_artist": artist}


def resolved_file_metadata(item: dict) -> dict:
    """Apply the display priority: written tags -> path structure -> filename."""
    result = dict(item)
    path = Path(result.get("path") or result.get("filename") or "")
    inferred = infer_path_metadata(path)
    artist = str(result.get("artist") or inferred["artist"] or "").strip()
    album = str(result.get("album") or inferred["album"] or "").strip()
    raw_title = result.get("title") or inferred["title"] or path.stem
    inferred_tags = set(item.get("tags_inferred") or [])
    result.update({
        "title": clean_track_title(raw_title, artist=artist, album=album),
        "artist": artist,
        "album": album,
        "album_artist": str(result.get("album_artist") or inferred["album_artist"] or artist).strip(),
        "metadata_inferred": {
            "artist": "artist" in inferred_tags or (not bool(str(item.get("artist") or "").strip()) and bool(artist)),
            "album": "album" in inferred_tags or (not bool(str(item.get("album") or "").strip()) and bool(album)),
            "title": "title" in inferred_tags or clean_track_title(str(item.get("title") or ""), artist=artist, album=album) != clean_track_title(raw_title, artist=artist, album=album),
            "album_artist": "album_artist" in inferred_tags,
        },
    })
    return result


def ignored_dir_names() -> set[str]:
    overrides = get_kv("ui_settings", {}) or {}
    configured = overrides.get("excludeDirs") or []
    return IGNORED_DIRS | {Path(str(value)).name for value in configured if str(value).strip()}


def _inside_music(path: Path) -> Path:
    resolved = path.resolve()
    root = settings.music_root.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("文件路径超出音乐目录")
    return resolved


def _inside_download(path: Path) -> Path:
    resolved = path.resolve()
    root = settings.download_mount.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("文件路径超出下载目录")
    return resolved


def _quick_hash(path: Path) -> str:
    digest = hashlib.sha256()
    size = path.stat().st_size
    digest.update(str(size).encode())
    with path.open("rb") as handle:
        digest.update(handle.read(1024 * 1024))
        if size > 2 * 1024 * 1024:
            handle.seek(max(0, size - 1024 * 1024))
            digest.update(handle.read(1024 * 1024))
    return digest.hexdigest()


def _tag_values(tags, name: str) -> list[str]:
    if not tags:
        return []
    normalized = str(name or "").casefold()
    if isinstance(tags, ID3):
        frame_id = ID3_TAGS.get(normalized, (str(name), None))[0]
        frame = tags.get(frame_id)
        values = getattr(frame, "text", None)
        if values is not None:
            return [str(value) for value in values]
        return [str(frame)] if frame is not None else []
    native_name = (
        ASF_TAGS.get(normalized, name)
        if isinstance(tags, ASFTags)
        else APE_TAGS.get(normalized, name)
        if isinstance(tags, APEv2)
        else normalized
    )
    value = tags.get(native_name)
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)] if value not in (None, "") else []


def _write_tag(audio, name: str, value):
    normalized = str(name or "").casefold()
    values = value if isinstance(value, (list, tuple)) else [value]
    values = [str(item) for item in values if item not in (None, "")]
    if audio.tags is None:
        audio.add_tags()
    if isinstance(audio.tags, ID3):
        frame_id, frame_type = ID3_TAGS[normalized]
        audio.tags.delall(frame_id)
        if values:
            audio.tags.add(frame_type(encoding=3, text=values))
        return
    native_name = (
        ASF_TAGS.get(normalized, normalized)
        if isinstance(audio.tags, ASFTags)
        else APE_TAGS.get(normalized, normalized)
        if isinstance(audio.tags, APEv2)
        else normalized
    )
    if not values:
        audio.tags.pop(native_name, None)
    else:
        audio.tags[native_name] = values


def _first(tags, *names):
    for name in names:
        values = _tag_values(tags, name)
        if values:
            return values[0]
    return ""


def _has_embedded_cover(audio) -> bool:
    if getattr(audio, "pictures", None):
        return bool(audio.pictures)
    tags = getattr(audio, "tags", None)
    if not tags:
        return False
    return any(str(key).upper().startswith("APIC") or str(key).lower() == "covr" for key in tags.keys())


class LocalLibraryService:
    def scan(self, payload: dict, progress):
        settings.music_root.mkdir(parents=True, exist_ok=True)
        paths = []
        for root, dirs, filenames in os.walk(settings.music_root):
            ignored = ignored_dir_names()
            dirs[:] = [name for name in dirs if name not in ignored]
            for filename in filenames:
                path = Path(root) / filename
                if path.suffix.casefold() in AUDIO_EXTENSIONS:
                    paths.append(path)
        seen = []
        errors = []
        stamp = now()
        for index, path in enumerate(paths, 1):
            try:
                item = self.inspect_file(path, stamp)
                seen.append(item["path"])
                with transaction() as conn:
                    conn.execute(
                        """INSERT INTO files(id,path,filename,ext,size,hash,format,bitrate,sample_rate,channels,duration,
                        title,artist,album,album_artist,year,track_number,disc_number,genre,has_cover,has_lrc,cover_path,cover_source,lyric_path,tags_inferred,
                        path_rule_ok,last_scanned_at,created_at,updated_at)
                        VALUES(:id,:path,:filename,:ext,:size,:hash,:format,:bitrate,:sample_rate,:channels,:duration,
                        :title,:artist,:album,:album_artist,:year,:track_number,:disc_number,:genre,:has_cover,:has_lrc,:cover_path,:cover_source,:lyric_path,:tags_inferred,
                        :path_rule_ok,:last_scanned_at,:created_at,:updated_at)
                        ON CONFLICT(path) DO UPDATE SET filename=excluded.filename,ext=excluded.ext,size=excluded.size,
                        hash=excluded.hash,format=excluded.format,bitrate=excluded.bitrate,sample_rate=excluded.sample_rate,
                        channels=excluded.channels,duration=excluded.duration,title=excluded.title,artist=excluded.artist,
                        album=excluded.album,album_artist=excluded.album_artist,year=excluded.year,
                        track_number=excluded.track_number,disc_number=excluded.disc_number,genre=excluded.genre,
                        has_cover=excluded.has_cover,has_lrc=excluded.has_lrc,cover_path=excluded.cover_path,
                        cover_source=excluded.cover_source,lyric_path=excluded.lyric_path,path_rule_ok=excluded.path_rule_ok,
                        tags_inferred=excluded.tags_inferred,
                        last_scanned_at=excluded.last_scanned_at,updated_at=excluded.updated_at""",
                        item,
                    )
            except Exception as exc:
                errors.append({"path": str(path), "error": str(exc)})
                continue
            if index == 1 or index % 20 == 0 or index == len(paths):
                progress(int(index / max(1, len(paths)) * 95), f"正在扫描本地曲库 {index}/{len(paths)}", index, len(paths))
        with transaction() as conn:
            if seen:
                placeholders = ",".join("?" for _ in seen)
                conn.execute(f"DELETE FROM files WHERE path NOT IN ({placeholders})", tuple(seen))
            else:
                conn.execute("DELETE FROM files")
        return {
            "scanned": len(seen), "success": len(seen), "failed": len(errors), "skipped": 0,
            "errors": errors[:100], "missing": self.stats(),
        }

    def inspect_file(self, path: Path, stamp: str | None = None):
        path = _inside_music(path)
        stat = path.stat()
        easy = MutagenFile(path, easy=True)
        raw = MutagenFile(path, easy=False)
        tags = getattr(easy, "tags", {}) or {}
        info = getattr(easy, "info", None)
        relative = path.relative_to(settings.music_root.resolve())
        parts = relative.parts
        inferred = infer_path_metadata(path)
        artist = _first(tags, "artist") or inferred["artist"]
        album = _first(tags, "album") or inferred["album"]
        item_id = hashlib.sha256(str(path).encode()).hexdigest()[:32]
        timestamp = stamp or now()
        cover_path = next((path.parent / name for name in ("cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png", "front.png") if (path.parent / name).exists()), None)
        embedded_cover = _has_embedded_cover(raw)
        lyric_path = next((path.with_suffix(suffix) for suffix in (".lrc", ".txt") if path.with_suffix(suffix).exists()), None)
        return {
            "id": item_id, "path": str(path), "filename": path.name, "ext": path.suffix.casefold(), "size": stat.st_size,
            "hash": _quick_hash(path), "format": easy.__class__.__name__ if easy else path.suffix.lstrip(".").upper(),
            "bitrate": int(getattr(info, "bitrate", 0) or 0), "sample_rate": int(getattr(info, "sample_rate", 0) or 0),
            "channels": int(getattr(info, "channels", 0) or 0), "duration": int(getattr(info, "length", 0) or 0),
            "title": clean_track_title(_first(tags, "title") or inferred["title"], artist=artist, album=album), "artist": artist, "album": album,
            "album_artist": _first(tags, "albumartist", "album artist") or inferred["album_artist"], "year": _first(tags, "date", "year"),
            "track_number": _first(tags, "tracknumber", "track"), "disc_number": _first(tags, "discnumber", "disc"),
            "genre": _first(tags, "genre"), "has_cover": int(embedded_cover or bool(cover_path)),
            "has_lrc": int(bool(lyric_path)), "cover_path": str(cover_path) if cover_path else None,
            "cover_source": "embedded" if embedded_cover else ("local" if cover_path else None),
            "lyric_path": str(lyric_path) if lyric_path else None,
            "tags_inferred": json.dumps([
                key for key, present in (
                    ("title", bool(_first(tags, "title"))), ("artist", bool(_first(tags, "artist"))),
                    ("album", bool(_first(tags, "album"))), ("album_artist", bool(_first(tags, "albumartist", "album artist"))),
                ) if not present
            ], ensure_ascii=False),
            "path_rule_ok": int(len(parts) >= 3 and parts[0] not in ignored_dir_names() and parts[-1] == path.name),
            "last_scanned_at": timestamp, "created_at": timestamp, "updated_at": timestamp,
        }

    def list(self, search="", missing="", limit=200, offset=0, scopes=None):
        conditions, params = [], []
        if scopes is not None and "*" not in scopes:
            scope_clauses = []
            for scope in scopes:
                scope = str(scope or "").strip().strip("/")
                if not scope or ".." in scope.split("/"):
                    continue
                scope_clauses.append("path LIKE ?")
                params.append(str(settings.music_root / scope) + os.sep + "%")
            conditions.append("(" + " OR ".join(scope_clauses) + ")" if scope_clauses else "1=0")
        if search:
            conditions.append("(filename LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ? OR path LIKE ?)")
            term = f"%{search}%"; params.extend([term] * 6)
        missing_map = {"cover": "has_cover=0", "lyrics": "has_lrc=0", "artist": "COALESCE(artist,'')=''", "album": "COALESCE(album,'')=''", "path": "path_rule_ok=0", "plex": "plex_matched=0"}
        if missing in missing_map:
            conditions.append(missing_map[missing])
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = row("SELECT COUNT(*) AS count FROM files" + where, tuple(params))["count"]
        items = rows("SELECT * FROM files" + where + " ORDER BY artist,album,track_number,title LIMIT ? OFFSET ?", tuple(params + [limit, offset]))
        return {"items": [_decode_file(item) for item in items], "total": total, "stats": self.stats()}

    def stats(self):
        result = row("""SELECT COUNT(*) total,SUM(has_cover=0) missing_cover,SUM(has_lrc=0) missing_lyrics,
        SUM(COALESCE(artist,'')='') missing_artist,SUM(COALESCE(album,'')='') missing_album,
        SUM(path_rule_ok=0) bad_path,SUM(plex_matched=0) plex_unmatched FROM files""") or {}
        return {key: int(value or 0) for key, value in result.items()}

    def categories(self):
        items = rows("""SELECT id,path,filename,ext,size,bitrate,sample_rate,title,artist,album,
        album_artist,year,genre,has_cover,has_lrc,plex_matched,path_rule_ok FROM files""")

        def clean(value, fallback="未分类"):
            value = str(value or "").strip()
            return value or fallback

        def push(map_, key, item):
            key = clean(key)
            entry = map_.setdefault(key, {"id": key, "name": key, "count": 0, "sample": [], "search": ""})
            entry["count"] += 1
            if len(entry["sample"]) < 4:
                entry["sample"].append({
                    "id": item.get("id"),
                    "title": item.get("title") or Path(item.get("path") or "").stem,
                    "artist": item.get("artist") or "未知歌手",
                    "album": item.get("album") or "未知专辑",
                })
            return entry

        artists, albums, genres, folders, formats, years, quality = {}, {}, {}, {}, {}, {}, {}
        company = {}
        moods = {"无歌词": 0, "缺封面": 0, "Plex 未匹配": 0, "目录待整理": 0}
        root = settings.music_root.resolve()
        for item in items:
            artist_name = item.get("album_artist") or item.get("artist")
            artist_entry = push(artists, artist_name, item); artist_entry["search"] = clean(artist_name)
            album_entry = push(albums, item.get("album"), item); album_entry["search"] = clean(item.get("album"))
            genre_value = clean(item.get("genre"), "未写入流派")
            for part in [value.strip() for value in genre_value.replace("；", ";").replace("/", ";").split(";") if value.strip()]:
                genre_entry = push(genres, part, item); genre_entry["search"] = part
            if not genre_value or genre_value == "未写入流派":
                genre_entry = push(genres, "未写入流派", item); genre_entry["missing"] = "genre"
            ext = clean(item.get("ext"), "unknown").lstrip(".").upper()
            format_entry = push(formats, ext, item); format_entry["search"] = "." + ext.lower()
            year = clean(str(item.get("year") or "")[:4], "未知年份")
            year_entry = push(years, year, item); year_entry["search"] = year if year != "未知年份" else ""
            bitrate = int(item.get("bitrate") or 0)
            ext_lower = clean(item.get("ext"), "").lower()
            if ext_lower in (".flac", ".ape", ".wav") or bitrate >= 900000:
                q = "无损 / Hi-Res"
            elif bitrate >= 256000:
                q = "高品质"
            elif bitrate > 0:
                q = "标准音质"
            else:
                q = "未知音质"
            push(quality, q, item)
            try:
                rel = Path(item.get("path") or "").resolve().relative_to(root)
                top = rel.parts[0] if rel.parts else "根目录"
            except Exception:
                top = "根目录"
            folder_entry = push(folders, top, item); folder_entry["search"] = top
            if not item.get("has_lrc"):
                moods["无歌词"] += 1
            if not item.get("has_cover"):
                moods["缺封面"] += 1
            if not item.get("plex_matched"):
                moods["Plex 未匹配"] += 1
            if not item.get("path_rule_ok"):
                moods["目录待整理"] += 1
            label = clean(item.get("genre"), "未知厂牌")
            if any(word in label.lower() for word in ("ost", "原声", "soundtrack")):
                push(company, "影视原声", item)
            elif "live" in label.lower() or "现场" in label:
                push(company, "现场 / Live", item)
            elif "华语" in label or "c-pop" in label.lower() or "mandopop" in label.lower():
                push(company, "华语流行", item)

        def top_values(map_, limit=24):
            return sorted(map_.values(), key=lambda value: (-value["count"], value["name"]))[:limit]

        stats = self.stats()
        summary = [
            {"id": "tracks", "label": "歌曲", "count": stats.get("total", 0), "note": "首歌曲"},
            {"id": "artists", "label": "艺人", "count": len([k for k in artists if k != "未分类"]), "note": "位艺人"},
            {"id": "albums", "label": "专辑", "count": len([k for k in albums if k != "未分类"]), "note": "张专辑"},
            {"id": "genres", "label": "流派", "count": len(genres), "note": "种流派"},
            {"id": "folders", "label": "文件夹", "count": len(folders), "note": "个顶层目录"},
            {"id": "lossless", "label": "无损", "count": quality.get("无损 / Hi-Res", {}).get("count", 0), "note": "首高规格"},
        ]
        missing = [
            {"id": "cover", "name": "缺封面", "count": stats.get("missing_cover", 0), "missing": "cover"},
            {"id": "lyrics", "name": "缺歌词", "count": stats.get("missing_lyrics", 0), "missing": "lyrics"},
            {"id": "artist", "name": "缺歌手", "count": stats.get("missing_artist", 0), "missing": "artist"},
            {"id": "album", "name": "缺专辑", "count": stats.get("missing_album", 0), "missing": "album"},
            {"id": "path", "name": "目录待整理", "count": stats.get("bad_path", 0), "missing": "path"},
            {"id": "plex", "name": "Plex 未匹配", "count": stats.get("plex_unmatched", 0), "missing": "plex"},
        ]
        return {
            "summary": summary,
            "groups": {
                "genre": top_values(genres, 36),
                "artist": top_values(artists, 36),
                "album": top_values(albums, 36),
                "folder": top_values(folders, 36),
                "format": top_values(formats, 16),
                "quality": top_values(quality, 12),
                "year": top_values(years, 32),
                "scene": top_values(company, 12),
                "missing": missing,
                "mood": [{"id": key, "name": key, "count": value} for key, value in moods.items()],
            },
            "total": len(items),
        }

    def update_tags(self, file_id: str, changes: dict):
        item = self.get(file_id); path = _inside_music(Path(item["path"]))
        allowed = set(TAG_NAMES)
        audio = MutagenFile(path, easy=True)
        if audio is None:
            raise ValueError("无法识别该音频格式")
        if audio.tags is None: audio.add_tags()
        before = {key: _tag_values(audio.tags, key) for key in TAG_NAMES}
        for key, value in changes.items():
            normalized = {"albumArtist": "albumartist", "year": "date", "trackNumber": "tracknumber", "discNumber": "discnumber"}.get(key, key)
            if normalized in allowed:
                _write_tag(audio, normalized, value)
        audio.save()
        after = {key: _tag_values(audio.tags, key) for key in TAG_NAMES}
        self._operation("tag_write", file_id, {"path": str(path), "tags": before}, {"path": str(path), "tags": after}, {"path": str(path), "tags": before})
        refreshed = self.inspect_file(path)
        with transaction() as conn:
            conn.execute("UPDATE files SET title=?,artist=?,album=?,album_artist=?,year=?,track_number=?,disc_number=?,genre=?,tags_inferred=?,updated_at=? WHERE id=?",
                         (refreshed["title"], refreshed["artist"], refreshed["album"], refreshed["album_artist"], refreshed["year"], refreshed["track_number"], refreshed["disc_number"], refreshed["genre"], refreshed["tags_inferred"], now(), file_id))
        return self.get(file_id)

    def get(self, file_id):
        item = row("SELECT * FROM files WHERE id=?", (str(file_id),))
        if not item: raise KeyError("本地文件不存在")
        return _decode_file(item)

    def sync_plex(self, payload: dict, progress):
        progress(5, "正在读取 Plex 歌手、专辑与曲目")
        artists, albums, tracks = plex.artists(), plex.albums(), plex.tracks()
        stamp, paths = now(), {}
        artist_dirs, album_dirs = {}, {}
        for track in tracks:
            mapped = local_media_path(track.get("file") or "")
            if not mapped:
                continue
            paths[str(mapped)] = str(track.get("ratingKey"))
            artist_key = str(track.get("grandparentRatingKey") or "")
            album_key = str(track.get("parentRatingKey") or "")
            if artist_key:
                try: artist_dirs[artist_key] = settings.music_root / mapped.relative_to(settings.music_root).parts[0]
                except Exception: pass
            if album_key:
                directory = mapped.parent
                if re.fullmatch(r"(?i)(cd|disc|disk)\s*\d+", directory.name): directory = directory.parent
                album_dirs[album_key] = directory

        def local_assets(item: dict, item_type: str):
            rating_key = str(item.get("ratingKey") or "")
            cover = poster = background = lyric = None
            if item_type == "artist":
                directory = artist_dirs.get(rating_key)
                if directory:
                    poster = directory / "artist-poster.jpg"
                    background = directory / "artist-background.jpg"
            elif item_type == "album":
                directory = album_dirs.get(rating_key)
                if directory:
                    cover = next((directory / name for name in ("cover.jpg", "folder.jpg", "front.jpg", "cover.png") if (directory / name).exists()), None)
            else:
                mapped = local_media_path(item.get("file") or "")
                if mapped:
                    lyric = next((mapped.with_suffix(suffix) for suffix in (".lrc", ".txt") if mapped.with_suffix(suffix).exists()), None)
                    cover = next((mapped.parent / name for name in ("cover.jpg", "folder.jpg", "front.jpg", "cover.png") if (mapped.parent / name).exists()), None)
            return cover, poster if poster and poster.exists() else None, background if background and background.exists() else None, lyric

        records = []
        typed_items = [("artist", item) for item in artists] + [("album", item) for item in albums] + [("track", item) for item in tracks]
        for index, (item_type, item) in enumerate(typed_items, 1):
            rating_key = str(item.get("ratingKey") or "")
            cover, poster, background, lyric = local_assets(item, item_type)
            summary = (item.get("summary") or "").strip()
            if item_type == "artist":
                artist, album, parent_key = item.get("title"), "", ""
            elif item_type == "album":
                artist, album, parent_key = item.get("parentTitle"), item.get("title"), item.get("parentRatingKey")
            else:
                artist, album, parent_key = item.get("grandparentTitle") or item.get("originalTitle"), item.get("parentTitle"), item.get("parentRatingKey")
            records.append({
                "id": uuid.uuid5(uuid.NAMESPACE_URL, "plex:" + rating_key).hex, "rating_key": rating_key,
                "guid": item.get("guid"), "type": item_type, "section_key": str(item.get("sectionKey") or ""),
                "parent_rating_key": str(parent_key or ""), "title": item.get("title"), "artist": artist, "album": album,
                "year": item.get("year"), "duration": int(item.get("duration") or 0), "file_path": item.get("file") or "",
                "thumb": item.get("thumb"), "art": item.get("art"), "summary": summary,
                "artist_bio_zh": summary if item_type == "artist" and has_chinese(summary) else "",
                "album_description_zh": summary if item_type == "album" and has_chinese(summary) else "",
                "metadata_source": "Plex", "cover_path": str(cover) if cover else None,
                "poster_path": str(poster) if poster else None, "background_path": str(background) if background else None,
                "has_cover": int(bool(item.get("thumb") or cover or poster)),
                "has_background": int(bool(item.get("art") or background)), "has_lyrics": int(bool(lyric)),
                "last_synced_at": stamp, "created_at": stamp, "updated_at": stamp,
            })
            if index % 100 == 0:
                progress(10 + int(index / max(1, len(typed_items)) * 75), f"同步 Plex 条目 {index}/{len(typed_items)}", index, len(typed_items))

        sql = """INSERT INTO plex_items(id,rating_key,guid,type,section_key,parent_rating_key,title,artist,album,year,duration,file_path,thumb,art,summary,artist_bio_zh,album_description_zh,metadata_source,cover_path,poster_path,background_path,has_cover,has_background,has_lyrics,last_synced_at,created_at,updated_at)
        VALUES(:id,:rating_key,:guid,:type,:section_key,:parent_rating_key,:title,:artist,:album,:year,:duration,:file_path,:thumb,:art,:summary,:artist_bio_zh,:album_description_zh,:metadata_source,:cover_path,:poster_path,:background_path,:has_cover,:has_background,:has_lyrics,:last_synced_at,:created_at,:updated_at)
        ON CONFLICT(rating_key) DO UPDATE SET guid=excluded.guid,type=excluded.type,section_key=excluded.section_key,parent_rating_key=excluded.parent_rating_key,title=excluded.title,artist=excluded.artist,album=excluded.album,year=excluded.year,duration=excluded.duration,file_path=excluded.file_path,thumb=excluded.thumb,art=excluded.art,summary=excluded.summary,
        artist_bio_zh=COALESCE(NULLIF(excluded.artist_bio_zh,''),plex_items.artist_bio_zh),album_description_zh=COALESCE(NULLIF(excluded.album_description_zh,''),plex_items.album_description_zh),metadata_source=COALESCE(plex_items.metadata_source,excluded.metadata_source),cover_path=COALESCE(excluded.cover_path,plex_items.cover_path),poster_path=COALESCE(excluded.poster_path,plex_items.poster_path),background_path=COALESCE(excluded.background_path,plex_items.background_path),has_cover=excluded.has_cover,has_background=excluded.has_background,has_lyrics=excluded.has_lyrics,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at"""
        with transaction() as conn:
            conn.execute("CREATE TEMP TABLE IF NOT EXISTS current_plex_keys(rating_key TEXT PRIMARY KEY)")
            conn.execute("DELETE FROM current_plex_keys")
            conn.executemany("INSERT INTO current_plex_keys(rating_key) VALUES(?)", [(item["rating_key"],) for item in records])
            conn.executemany(sql, records)
            conn.execute("DELETE FROM plex_items WHERE rating_key NOT IN (SELECT rating_key FROM current_plex_keys)")
            conn.execute("UPDATE files SET plex_matched=0,plex_rating_key=NULL")
            for path, rating_key in paths.items():
                conn.execute("UPDATE files SET plex_matched=1,plex_rating_key=? WHERE path=?", (rating_key, path))
        saved = plex.saved_settings(); saved["lastSyncAt"] = stamp; set_kv("plex_settings", saved)
        matched = row("SELECT COUNT(*) count FROM files WHERE plex_matched=1")["count"]
        return {
            "plexItems": len(records), "artists": len(artists), "albums": len(albums), "tracks": len(tracks),
            "matched": matched, "success": len(records), "failed": 0, "skipped": 0,
        }

    def health(self, duplicate_limit: int = 40):
        """Whole-library checkup: one scan, every issue grouped by what fixes it.

        This exists because the fixing tools already existed but were only
        reachable if you already knew you had the problem. The checkup turns
        "37 files have no cover" into a link that opens the cover tool with
        that filter already applied.

        Every item carries `page` and `filter` so the UI does not have to keep
        its own copy of the mapping from issue to tool.
        """
        stats = self.stats()
        total = stats.get("total", 0)

        checks = [
            {"id": "cover", "label": "缺封面", "count": stats.get("missing_cover", 0),
             "hint": "「封面与歌词」能一次补齐", "page": "scrape", "filter": "cover", "severity": "info"},
            {"id": "lyrics", "label": "缺歌词", "count": stats.get("missing_lyrics", 0),
             "hint": "「封面与歌词」能一次补齐", "page": "scrape", "filter": "lyrics", "severity": "info"},
            {"id": "artist", "label": "没有歌手", "count": stats.get("missing_artist", 0),
             "hint": "「文件与标签 → 补标签」可以从路径推断", "page": "local", "filter": "artist", "severity": "warning"},
            {"id": "album", "label": "没有专辑", "count": stats.get("missing_album", 0),
             "hint": "「文件与标签 → 补标签」可以从路径推断", "page": "local", "filter": "album", "severity": "warning"},
            {"id": "path", "label": "目录不规范", "count": stats.get("bad_path", 0),
             "hint": "「文件与标签 → 整理目录」按命名规则归位", "page": "local", "filter": "path", "severity": "info"},
            {"id": "plex", "label": "Plex 没对上", "count": stats.get("plex_unmatched", 0),
             "hint": "同步一次 Plex 对照通常就好了", "page": "local", "filter": "plex", "severity": "info"},
        ]

        duplicates = self._duplicate_groups(duplicate_limit)
        missing_files = self._missing_on_disk()

        if duplicates["total"]:
            checks.append({
                "id": "duplicate", "label": "疑似重复", "count": duplicates["total"],
                "hint": "同一首歌存了多份，留码率最高的那个就行",
                "page": "local", "filter": "", "severity": "warning",
            })
        if missing_files["total"]:
            checks.append({
                "id": "orphan", "label": "文件已经不在了", "count": missing_files["total"],
                "hint": "曲库里还有记录，但磁盘上找不到 —— 重新扫一次会清掉",
                "page": "local", "filter": "", "severity": "danger",
            })

        flagged = sum(check["count"] for check in checks)
        # 得分只用来给一个"大概多干净"的印象，不做任何决策，
        # 所以刻意用最朴素的算法，不加权重。
        score = 100 if not total else max(0, round(100 - min(100, flagged * 100 / max(total, 1))))

        return {
            "total": total,
            "checkedAt": now(),
            "score": score,
            "clean": flagged == 0,
            "checks": [check for check in checks if check["count"]],
            "allChecks": checks,
            "duplicates": duplicates["groups"],
            "duplicateTotal": duplicates["total"],
            "missingOnDisk": missing_files["items"],
            "missingOnDiskTotal": missing_files["total"],
        }

    def _duplicate_groups(self, limit: int):
        """Same song stored more than once.

        Two passes, strongest signal first:

        1. identical content hash — byte-for-byte the same file in two places.
        2. same normalized title+artist AND duration within 2 seconds.
           Duration is the guard that keeps covers, live versions and remixes
           out of the group; without it "晴天" by two different artists,
           or a 30s intro clip, would be reported as duplicates.

        Files whose duration is unknown (0) are skipped in pass 2 — with no
        duration there is nothing separating a real duplicate from a
        same-titled different recording, and a wrong "delete this" suggestion
        is worse than no suggestion.
        """
        items = rows("""SELECT id,path,filename,title,artist,album,duration,bitrate,size,ext,hash
                        FROM files""")
        groups: dict[tuple, list] = {}

        for item in items:
            key = None
            if item.get("hash"):
                key = ("hash", item["hash"])
            else:
                title = _norm(item.get("title") or Path(item["path"]).stem)
                artist = _norm(item.get("artist") or "")
                duration = int(item.get("duration") or 0)
                if title and duration:
                    # 时长按 3 秒一档分桶，同一首歌的不同转码差几百毫秒。
                    key = ("meta", title, artist, duration // 3)
            if key:
                groups.setdefault(key, []).append(item)

        found = []
        for key, members in groups.items():
            if len(members) < 2:
                continue
            # 码率高的排前面 —— 用户几乎总是留最好的那个。
            members.sort(key=lambda item: (int(item.get("bitrate") or 0), int(item.get("size") or 0)), reverse=True)
            found.append({
                "key": "|".join(str(part) for part in key),
                "reason": "文件完全相同" if key[0] == "hash" else "曲名、歌手和时长都对得上",
                "title": members[0].get("title") or Path(members[0]["path"]).stem,
                "artist": members[0].get("artist") or "",
                "items": [{
                    "id": item["id"],
                    "path": item["path"],
                    "ext": item.get("ext") or "",
                    "bitrate": int(item.get("bitrate") or 0),
                    "size": int(item.get("size") or 0),
                    "duration": int(item.get("duration") or 0),
                    # 建议保留的那个，由前端渲染成"留这个"，不自动执行。
                    "keep": index == 0,
                } for index, item in enumerate(members)],
            })

        found.sort(key=lambda group: len(group["items"]), reverse=True)
        return {"groups": found[:limit], "total": len(found)}

    def find_similar(self, title: str, artist: str, duration: int = 0, limit: int = 4):
        """Library files that look like the same recording as the one described.

        Used before ingesting a download, so the user finds out *before* the
        move that they already own this song at a different path. The existing
        `conflict` flag only catches a same-path collision, which misses the
        common case entirely: dropping `晴天.mp3` in when the library already
        has `周杰伦/叶惠美/03 - 晴天.flac` produces two different targets and
        therefore no conflict, and you silently end up with two copies.

        Same matching rule as _duplicate_groups, deliberately: if the checkup
        would call two files duplicates, ingest should warn about them too.
        Different rules in the two places would be worse than either rule.
        """
        key_title = _norm(title)
        if not key_title:
            return []
        key_artist = _norm(artist)
        found = []
        for item in rows("""SELECT id,path,title,artist,album,duration,bitrate,size,ext
                            FROM files WHERE title IS NOT NULL"""):
            if _norm(item.get("title") or "") != key_title:
                continue
            if key_artist and _norm(item.get("artist") or "") != key_artist:
                continue
            existing_duration = int(item.get("duration") or 0)
            # 两边都知道时长才比；有一边不知道就只靠曲名歌手，
            # 宁可多提醒一次，也好过入库之后才发现重了。
            if duration and existing_duration and abs(existing_duration - duration) > 3:
                continue
            found.append({
                "id": item["id"],
                "path": item["path"],
                "album": item.get("album") or "",
                "ext": item.get("ext") or "",
                "bitrate": int(item.get("bitrate") or 0),
                "size": int(item.get("size") or 0),
                "duration": existing_duration,
            })
        found.sort(key=lambda entry: entry["bitrate"], reverse=True)
        return found[:limit]

    def _missing_on_disk(self, limit: int = 60):
        """Rows whose file is gone. A stale index makes every count wrong."""
        gone = []
        for item in rows("SELECT id,path,filename,artist,album FROM files"):
            if not Path(item["path"]).exists():
                gone.append(item)
        return {"items": gone[:limit], "total": len(gone)}

    def _tag_candidates(self, file_ids: list[str] | None, limit: int = 1000):
        selected = {str(value) for value in (file_ids or []) if value}
        if selected:
            return [self.get(file_id) for file_id in selected]
        return self.list("", "", limit, 0)["items"]

    def missing_tag_preview(self, file_ids: list[str] | None = None, limit: int = 300):
        """Report what fill_missing_tags would write, without touching any file.

        The UI needs to show "current value -> proposed value" before writing.
        Recomputing the inference in the browser would drift from
        infer_path_metadata, so the preview and the job share this one path.
        """
        items = []
        for item in self._tag_candidates(file_ids, limit):
            path = Path(item["path"])
            audio = MutagenFile(path, easy=True)
            tags = getattr(audio, "tags", {}) if audio else {}
            inferred = infer_path_metadata(path)
            fields, conflicts = [], []
            for tag, value in (("title", inferred["title"]), ("artist", inferred["artist"]),
                               ("album", inferred["album"]), ("albumArtist", inferred["album_artist"])):
                lookup = "albumartist" if tag == "albumArtist" else tag
                current = _first(tags, lookup) or ""
                if not value:
                    continue
                if not current:
                    fields.append({"field": tag, "oldValue": "", "newValue": value})
                elif _norm(current) != _norm(value):
                    # 路径说的和文件里写的不一样。
                    #
                    # 补全任务永远不会碰这种字段（它只填空的），所以在这之前
                    # 用户根本不会知道两边对不上。但这恰恰是最该由人来判断的
                    # 情况：可能是标签错了，也可能是目录名错了，程序猜不出来。
                    #
                    # 所以报出来但**不放进 fields** —— fields 是"会被写入的",
                    # 混进去就等于默认帮用户做了决定。
                    conflicts.append({"field": tag, "oldValue": current, "newValue": value})
            items.append({
                "fileId": item["id"],
                "path": item["path"],
                "fields": fields,
                "conflicts": conflicts,
                # 没有可补的字段也返回，前端才能说明"这些已经是全的"，
                # 而不是让用户猜为什么清单比曲库短。
                "skipReason": "" if fields else (
                    "四个字段都有值，但和目录名对不上" if conflicts else "四个字段都已经有值"
                ),
            })
        return {
            "items": items,
            "total": len(items),
            "changeable": sum(1 for item in items if item["fields"]),
            "conflicted": sum(1 for item in items if item["conflicts"]),
        }

    def fill_missing_tags(self, payload: dict, progress):
        selected = {str(item.get("entityId")) for item in (payload.get("items") or []) if item.get("entityId")}
        candidates = [self.get(file_id) for file_id in selected] if selected else self.list("", "", 1000, 0)["items"]
        success, skipped, errors = 0, 0, []
        for index, item in enumerate(candidates, 1):
            path = Path(item["path"]); audio = MutagenFile(path, easy=True); tags = getattr(audio, "tags", {}) if audio else {}
            inferred = infer_path_metadata(path)
            changes = {}
            for tag, value in (("title", inferred["title"]), ("artist", inferred["artist"]), ("album", inferred["album"]), ("albumArtist", inferred["album_artist"])):
                lookup = "albumartist" if tag == "albumArtist" else tag
                if value and not _first(tags, lookup): changes[tag] = value
            if not changes:
                skipped += 1
            else:
                try: self.update_tags(item["id"], changes); success += 1
                except Exception as exc: errors.append({"path": str(path), "error": str(exc)})
            progress(int(index / max(1, len(candidates)) * 95), f"补全本地标签 {index}/{len(candidates)}", index, len(candidates))
        return {"success": success, "failed": len(errors), "skipped": skipped, "errors": errors[:100]}

    def _operation(self, action, target_id, before, after, rollback, status="success", error=None):
        with transaction() as conn:
            conn.execute("INSERT INTO operation_logs(id,action,target_type,target_id,before_state,after_state,rollback_data,rollbackable,status,error_message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (uuid.uuid4().hex,action,"file",target_id,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),json.dumps(rollback,ensure_ascii=False),1,status,error,now()))

    def rollback(self, operation_id: str):
        operation = row("SELECT * FROM operation_logs WHERE id=?", (operation_id,))
        if not operation or not operation.get("rollbackable"):
            raise ValueError("该操作不存在或不可回滚")
        data = json.loads(operation.get("rollback_data") or "{}")
        if operation["action"] == "tag_write":
            path = _inside_music(Path(data["path"])); audio = MutagenFile(path, easy=True)
            if audio is None: raise ValueError("无法打开音频文件以回滚标签")
            if audio.tags is None: audio.add_tags()
            for key, value in (data.get("tags") or {}).items():
                _write_tag(audio, key, value)
            audio.save()
        elif operation["action"] == "organize_move":
            source = _inside_music(Path(data["from"])); target = _inside_music(Path(data["to"]))
            if not source.exists(): raise ValueError("回滚源文件已经不存在")
            if target.exists(): raise ValueError("原位置已有文件，无法安全回滚")
            target.parent.mkdir(parents=True, exist_ok=True); shutil.move(str(source), str(target))
            source_lrc = source.with_suffix('.lrc')
            if source_lrc.exists(): shutil.move(str(source_lrc), str(target.with_suffix('.lrc')))
        elif operation["action"] in ("download_ingest", "download_inbox_ingest"):
            source = _inside_music(Path(data["from"]))
            target = _inside_download(Path(data["to"]))
            if not source.exists(): raise ValueError("回滚源文件已经不存在")
            if target.exists(): raise ValueError("下载目录原位置已有文件，无法安全回滚")
            target.parent.mkdir(parents=True, exist_ok=True); shutil.move(str(source), str(target))
            source_lrc = source.with_suffix('.lrc')
            if source_lrc.exists(): shutil.move(str(source_lrc), str(target.with_suffix('.lrc')))
        else:
            raise ValueError("暂不支持回滚该操作类型")
        with transaction() as conn:
            conn.execute("UPDATE operation_logs SET rollbackable=0,status='rolled_back' WHERE id=?", (operation_id,))
        return {"ok": True, "operationId": operation_id}


class OrganizeService:
    def preview(self, file_ids):
        previews=[]
        defaults = {
            "album": "{artist}/{album} ({year})/{trackNumber} - {title}.{ext}",
            "multiDisc": "{artist}/{album} ({year})/Disc {discNumber}/{trackNumber} - {title}.{ext}",
            "compilation": "Various Artists/{album} ({year})/{trackNumber} - {artist} - {title}.{ext}",
            "unknown": "{artist}/Unknown Album/{title}.{ext}",
        }
        templates = (get_kv("ui_settings", {}) or {}).get("namingTemplates") or defaults
        for file_id in file_ids:
            item=local_library.get(file_id); source=Path(item["path"])
            artist=safe_name(item.get("album_artist") or item.get("artist"),"Unknown Artist")
            album=safe_name(item.get("album"),"Unknown Album");year=(item.get("year") or "").split("-",1)[0]
            title=safe_name(item.get("title"),source.stem);track=str(item.get("track_number") or "").split("/",1)[0]
            disc=str(item.get("disc_number") or "").split("/",1)[0]
            template_key = "unknown" if album == "Unknown Album" else ("compilation" if artist.casefold() == "various artists" else ("multiDisc" if disc.isdigit() and int(disc) > 1 else "album"))
            template = str(templates.get(template_key) or defaults[template_key]).lstrip("/\\")
            if template_key == "multiDisc" and "{discNumber}{trackNumber}" in template:
                template = defaults["multiDisc"]
            values = {
                "artist": artist,
                "album": album,
                "year": safe_name(year, "Unknown Year"),
                "trackNumber": f"{int(track):02d}" if track.isdigit() else "00",
                "discNumber": str(int(disc)) if disc.isdigit() else "1",
                "title": title,
                "ext": source.suffix.casefold().lstrip("."),
            }
            relative = template
            for key, value in values.items():
                relative = relative.replace("{" + key + "}", value)
            if re.search(r"{[^}]+}", relative):
                raise ValueError(f"命名模板包含未支持字段：{relative}")
            target = (settings.music_root / relative).resolve()
            _inside_music(target)
            previews.append({"fileId":file_id,"sourcePath":str(source),"targetPath":str(target),"targetDirectory":str(target.parent),"targetFilename":target.name,"lyricPath":str(target.with_suffix('.lrc')),"coverPath":str(target.parent/'cover.jpg'),"conflict":target.exists() and target.resolve()!=source.resolve(),"overwrite":False,"safe":True,"plexRuleOk":True})
        return previews

    def apply(self, previews, progress=lambda *args: None):
        moved=[]
        for index, preview in enumerate(previews,1):
            source=_inside_music(Path(preview["sourcePath"]));target=_inside_music(Path(preview["targetPath"]))
            if target.exists() and target.resolve()!=source.resolve(): raise ValueError(f"目标已存在：{target}")
            target.parent.mkdir(parents=True,exist_ok=True)
            before={"path":str(source)}; source_lrc=source.with_suffix('.lrc')
            if source.resolve()!=target.resolve(): shutil.move(str(source),str(target))
            if source_lrc.exists(): shutil.move(str(source_lrc),str(target.with_suffix('.lrc')))
            local_library._operation("organize_move",preview.get("fileId"),before,{"path":str(target)},{"from":str(target),"to":str(source)})
            with transaction() as conn: conn.execute("UPDATE files SET path=?,filename=?,path_rule_ok=1,updated_at=? WHERE id=?",(str(target),target.name,now(),preview.get("fileId")))
            moved.append(str(target));progress(int(index/max(1,len(previews))*90),f"正在整理文件 {index}/{len(previews)}")
        return {"moved":moved}


def _decode_file(item):
    for key in ("has_cover","has_lrc","plex_matched","path_rule_ok"): item[key]=bool(item.get(key))
    try: item["tags_inferred"] = json.loads(item.get("tags_inferred") or "[]")
    except (TypeError, json.JSONDecodeError): item["tags_inferred"] = []
    item["metadata_inferred"] = {key: key in item["tags_inferred"] for key in ("title", "artist", "album", "album_artist")}
    return resolved_file_metadata(item)


local_library=LocalLibraryService()
organizer=OrganizeService()
