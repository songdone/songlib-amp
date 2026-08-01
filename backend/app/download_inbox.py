from __future__ import annotations

import json
import os
import re
import shutil
import unicodedata
import uuid
from pathlib import Path

from mutagen import File as MutagenFile

from .config import settings
from .db import now, transaction
from .downloader import safe_name
from .local_library import AUDIO_EXTENSIONS, clean_track_title, local_library
from .plex import plex


INBOX_IGNORED = {"_incoming", ".trash", "@eaDir", "#recycle", ".snapshot"}


def _inside(path: Path, root: Path, label: str) -> Path:
    resolved = path.resolve()
    base = root.resolve()
    if resolved != base and base not in resolved.parents:
        raise ValueError(f"{label}路径超出允许目录")
    return resolved


def _repair_mojibake(value: str) -> str:
    """Apply Unicode normalization and only accept a reversible UTF-8 repair."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    text = unicodedata.normalize("NFKC", raw)
    suspicious_marks = ("Ã", "Â", "æ", "å", "ç", "ð", "�", "Œ", "›")
    suspicious = sum(raw.count(mark) for mark in suspicious_marks)
    if not suspicious:
        return text
    has_cjk = lambda item: any("\u3400" <= char <= "\u9fff" for char in item)
    for codec in ("cp1252", "latin-1"):
        try:
            candidate = raw.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        candidate = unicodedata.normalize("NFKC", candidate).strip()
        next_suspicious = sum(candidate.count(mark) for mark in suspicious_marks)
        if (has_cjk(candidate) and not has_cjk(raw)) or next_suspicious < suspicious:
            return candidate
    return text


def _tag(tags, *names) -> str:
    for name in names:
        value = tags.get(name) if tags else None
        if isinstance(value, (list, tuple)) and value:
            return _repair_mojibake(value[0])
        if value not in (None, ""):
            return _repair_mojibake(value)
    return ""


def _inferred_metadata(path: Path) -> dict:
    relative = path.resolve().relative_to(settings.download_mount.resolve())
    parts = [part for part in relative.parts if part not in INBOX_IGNORED]
    stem = _repair_mojibake(path.stem)
    title = stem
    artist = _repair_mojibake(parts[-3]) if len(parts) >= 3 else ""
    album = _repair_mojibake(parts[-2]) if len(parts) >= 2 else ""
    split = [part.strip() for part in re.split(r"\s+-\s+", stem, maxsplit=1) if part.strip()]
    if len(split) == 2:
        if not artist:
            artist = split[0]
        title = split[1] if artist.casefold() == split[0].casefold() else stem
    return {"title": clean_track_title(title, artist=artist, album=album), "artist": artist, "album": album}


class DownloadInboxService:
    def _files(self) -> list[Path]:
        settings.download_mount.mkdir(parents=True, exist_ok=True)
        files: list[Path] = []
        for root, dirs, names in os.walk(settings.download_mount):
            dirs[:] = [name for name in dirs if name not in INBOX_IGNORED]
            for name in names:
                path = Path(root) / name
                if path.suffix.casefold() in AUDIO_EXTENSIONS:
                    files.append(path.resolve())
        return sorted(files, key=lambda item: str(item).casefold())

    def preview(self, limit: int = 500) -> dict:
        items = []
        errors = []
        for path in self._files()[:limit]:
            try:
                audio = MutagenFile(path, easy=True)
                tags = getattr(audio, "tags", {}) or {}
                info = getattr(audio, "info", None)
                inferred = _inferred_metadata(path)
                artist = _tag(tags, "albumartist", "album artist", "artist") or inferred["artist"] or "Unknown Artist"
                album = _tag(tags, "album") or inferred["album"] or "Unknown Album"
                title = clean_track_title(_tag(tags, "title") or inferred["title"], artist=artist, album=album)
                year = (_tag(tags, "date", "year") or "")[:4]
                track = (_tag(tags, "tracknumber", "track") or "0").split("/", 1)[0]
                album_dir = safe_name(album, "Unknown Album")
                if year.isdigit():
                    album_dir += f" ({year})"
                filename = f"{int(track):02d} - {safe_name(title, path.stem)}{path.suffix.casefold()}" if track.isdigit() and int(track) > 0 else f"{safe_name(title, path.stem)}{path.suffix.casefold()}"
                target = (settings.music_root / safe_name(artist, "Unknown Artist") / album_dir / filename).resolve()
                _inside(target, settings.music_root, "音乐库")
                items.append({
                    "sourcePath": str(path),
                    "targetPath": str(target),
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "duration": round(float(getattr(info, "length", 0) or 0)),
                    "format": path.suffix.casefold().lstrip(".").upper(),
                    "conflict": target.exists(),
                    "metadataSource": "tags" if tags else "path",
                    "needsReview": artist == "Unknown Artist" or album == "Unknown Album",
                })
            except Exception as exc:
                errors.append({"sourcePath": str(path), "error": str(exc)})
        return {
            "items": items,
            "errors": errors,
            "summary": {
                "total": len(items),
                "ready": len([item for item in items if not item["conflict"] and not item["needsReview"]]),
                "review": len([item for item in items if item["needsReview"]]),
                "conflicts": len([item for item in items if item["conflict"]]),
            },
            "downloadRoot": str(settings.download_mount),
            "musicRoot": str(settings.music_root),
        }

    def ingest(self, payload: dict, progress=lambda *args: None) -> dict:
        requested = payload.get("items") or []
        if not requested:
            raise ValueError("没有选择待入库歌曲")
        moved = []
        errors = []
        for index, item in enumerate(requested, 1):
            try:
                source = _inside(Path(item.get("sourcePath") or ""), settings.download_mount, "下载")
                target = _inside(Path(item.get("targetPath") or ""), settings.music_root, "音乐库")
                if not source.exists() or source.suffix.casefold() not in AUDIO_EXTENSIONS:
                    raise ValueError("源音频不存在或格式不支持")
                if target.exists():
                    raise ValueError("目标文件已存在")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(target))
                for suffix in (".lrc", ".txt"):
                    sidecar = source.with_suffix(suffix)
                    if sidecar.exists():
                        shutil.move(str(sidecar), str(target.with_suffix(suffix)))
                with transaction() as conn:
                    conn.execute(
                        """INSERT INTO operation_logs(
                             id,action,target_type,before_state,after_state,rollback_data,
                             rollbackable,status,created_at
                           ) VALUES(?,?,?,?,?,?,?,?,?)""",
                        (
                            uuid.uuid4().hex,
                            "download_inbox_ingest",
                            "file",
                            json.dumps({"path": str(source)}, ensure_ascii=False),
                            json.dumps({"path": str(target)}, ensure_ascii=False),
                            json.dumps({"from": str(target), "to": str(source)}, ensure_ascii=False),
                            1,
                            "success",
                            now(),
                        ),
                    )
                moved.append(str(target))
            except Exception as exc:
                errors.append({"sourcePath": item.get("sourcePath"), "error": str(exc)})
            progress(int(index / max(1, len(requested)) * 78), f"正在整理下载文件 {index}/{len(requested)}", index, len(requested))
        if moved:
            progress(82, "正在更新本地音乐库")
            local_library.scan({}, lambda *args: None)
            try:
                plex.scan()
                plex_warning = ""
            except Exception as exc:
                plex_warning = str(exc)
        else:
            plex_warning = ""
        return {"moved": moved, "errors": errors, "success": len(moved), "failed": len(errors), "plexWarning": plex_warning}


download_inbox = DownloadInboxService()
