from __future__ import annotations

import json
import os
import re
import shutil
import urllib.parse
import uuid
from pathlib import Path

import httpx
from mutagen import File as MutagenFile
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3
from mutagen.mp4 import MP4, MP4Cover

from .catalog import lyrics_for
from .config import settings
from .network import validate_public_url
from .plex import plex
from .sources import resolve_track_with_fallback
from .db import now, transaction


CONTENT_EXTENSIONS = {
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


def safe_name(value: str, fallback="Unknown"):
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", value or "").strip(" .")
    value = re.sub(r"\s+", " ", value)
    return value[:150] or fallback


def streamed_download(url: str, temp_path: Path, progress, extra_headers=None, platform=""):
    max_bytes = settings.max_download_mb * 1024 * 1024
    current = url
    with httpx.Client(timeout=httpx.Timeout(30, read=120), follow_redirects=False) as client:
        for _ in range(6):
            validate_public_url(current, label="下载地址")
            referer = "https://music.163.com/" if platform == "wy" else "https://y.qq.com/"
            headers = {"User-Agent": "Mozilla/5.0", "Referer": referer, **(extra_headers or {})}
            with client.stream("GET", current, headers=headers) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise RuntimeError("下载重定向缺少目标地址")
                    current = urllib.parse.urljoin(current, location)
                    continue
                response.raise_for_status()
                total = int(response.headers.get("content-length") or 0)
                if total > max_bytes:
                    raise RuntimeError(f"文件超过 {settings.max_download_mb}MB 限制")
                written = 0
                with temp_path.open("wb") as handle:
                    for chunk in response.iter_bytes(256 * 1024):
                        written += len(chunk)
                        if written > max_bytes:
                            raise RuntimeError(f"文件超过 {settings.max_download_mb}MB 限制")
                        handle.write(chunk)
                        if total:
                            progress(min(85, 10 + int(written / total * 70)), f"正在下载 {written / 1024 / 1024:.1f}MB")
                    handle.flush()
                    os.fsync(handle.fileno())
                content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if content_type in ("text/html", "application/json", "text/json"):
                    raise RuntimeError("音乐源返回的是网页或 JSON，不是音频文件")
                with temp_path.open("rb") as probe:
                    beginning = probe.read(512).lstrip().lower()
                if beginning.startswith((b"<html", b"<!doctype", b"{")):
                    raise RuntimeError("音乐源返回的内容不是音频文件")
                return current, content_type, written
        raise RuntimeError("下载重定向次数过多")


def choose_extension(final_url: str, content_type: str, quality: str):
    if content_type in CONTENT_EXTENSIONS:
        return CONTENT_EXTENSIONS[content_type]
    suffix = Path(urllib.parse.urlparse(final_url).path).suffix.lower()
    if suffix in (".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav"):
        return suffix
    return ".flac" if quality.startswith("flac") else ".mp3"


def download_cover(url: str):
    if not url:
        return b"", "image/jpeg"
    current = url
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        for _ in range(6):
            validate_public_url(current, label="封面地址")
            response = client.get(current, headers={"User-Agent": "Mozilla/5.0"})
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if not location:
                    return b"", "image/jpeg"
                current = urllib.parse.urljoin(current, location)
                continue
            response.raise_for_status()
            if len(response.content) > 15 * 1024 * 1024:
                return b"", "image/jpeg"
            return response.content, response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    return b"", "image/jpeg"


def write_tags(path: Path, item: dict, cover: bytes, cover_type: str):
    audio = MutagenFile(path, easy=True)
    if audio is not None:
        if audio.tags is None:
            audio.add_tags()
        audio["title"] = [item.get("title", "")]
        audio["artist"] = [item.get("artist", "")]
        audio["album"] = [item.get("album") or "Singles"]
        if item.get("albumArtist"):
            audio["albumartist"] = [item["albumArtist"]]
        if item.get("year"):
            audio["date"] = [str(item["year"])]
        if item.get("trackNumber"):
            audio["tracknumber"] = [str(item["trackNumber"])]
        if item.get("discNumber"):
            audio["discnumber"] = [str(item["discNumber"])]
        audio.save()
    if not cover:
        return
    if path.suffix.lower() == ".flac":
        flac = FLAC(path)
        picture = Picture()
        picture.type = 3
        picture.mime = cover_type
        picture.desc = "Cover"
        picture.data = cover
        flac.clear_pictures()
        flac.add_picture(picture)
        flac.save()
    elif path.suffix.lower() == ".mp3":
        try:
            tags = ID3(path)
        except Exception:
            tags = ID3()
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime=cover_type, type=3, desc="Cover", data=cover))
        tags.save(path)
    elif path.suffix.lower() in (".m4a", ".mp4"):
        mp4 = MP4(path)
        image_format = MP4Cover.FORMAT_PNG if "png" in cover_type else MP4Cover.FORMAT_JPEG
        mp4["covr"] = [MP4Cover(cover, imageformat=image_format)]
        mp4.save()


def download_song(payload: dict, progress):
    source_id = str(payload["sourceId"])
    quality = payload.get("quality") or "320k"
    item = payload["item"]
    progress(3, "开始解析音乐源下载地址")
    resolved = resolve_track_with_fallback(source_id, item, quality, require_enabled=True)
    resolved_quality = resolved.get("quality") or quality
    progress(8, "下载地址解析成功，准备写入临时区")
    settings.incoming_dir.mkdir(parents=True, exist_ok=True)
    token = safe_name(f"{item.get('artist')} - {item.get('title')}", "download") + f"-{uuid.uuid4().hex[:10]}"
    temp_path = settings.incoming_dir / (token + ".download")
    staged_path = None
    staged_lrc = None
    staged_cover = None
    keep_staged = False
    try:
        final_url, content_type, size = streamed_download(
            resolved["url"], temp_path, progress, resolved.get("headers"), resolved.get("platform")
        )
        extension = choose_extension(final_url, content_type, resolved_quality)
        staged_path = settings.incoming_dir / (token + extension)
        os.replace(temp_path, staged_path)
        progress(82, "音频下载完成，开始写入基础标签")
        cover, cover_type = download_cover(item.get("coverUrl") or item.get("cover") or "")
        try:
            write_tags(staged_path, item, cover, cover_type)
        except Exception as exc:
            tag_warning = str(exc)
        else:
            tag_warning = ""
        progress(88, "标签写入完成，开始补齐封面与歌词")
        lyric = lyrics_for(item)
        if lyric.strip():
            staged_lrc = staged_path.with_suffix(".lrc")
            staged_lrc.write_text(lyric.replace("\r\n", "\n"), encoding="utf-8")

        artist = safe_name(item.get("albumArtist") or item.get("artist"), "Unknown Artist")
        album = safe_name(item.get("album") or "Unknown Album", "Unknown Album")
        year = str(item.get("year") or "").strip()
        album_folder = f"{album} ({safe_name(year)})" if year else album
        album_dir = settings.music_root / artist / album_folder
        title = safe_name(item.get("title"), "Unknown Title")
        track = str(item.get("trackNumber") or "").strip()
        disc = str(item.get("discNumber") or "").strip()
        if track.isdigit():
            number = int(track) + (int(disc) * 100 if disc.isdigit() and int(disc) > 1 else 0)
            base = f"{number:02d} - {title}"
        else:
            base = title
        if artist == "Various Artists" and item.get("artist"):
            base = safe_name(f"{base} - {item['artist']}")
        target = album_dir / (base + extension)
        requested_target = target
        counter = 1
        while target.exists():
            target = album_dir / f"{base} ({counter}){extension}"
            counter += 1
        if cover:
            staged_cover = staged_path.with_suffix(".cover.jpg")
            staged_cover.write_bytes(cover)
        progress(95, "下载与元数据处理完成，等待确认入库路径")
        keep_staged = True
        return {
            "waitingConfirm": True,
            "preview": {
                "incomingPath": str(staged_path), "title": item.get("title") or "", "artist": item.get("artist") or "",
                "album": item.get("album") or "Unknown Album", "year": year, "trackNumber": track, "discNumber": disc,
                "quality": resolved_quality, "requestedQuality": quality,
                "qualityFallback": resolved_quality != quality,
                "targetDirectory": str(album_dir), "targetPath": str(target), "targetFilename": target.name,
                "lyricIncomingPath": str(staged_lrc) if staged_lrc else None, "lyricPath": str(target.with_suffix('.lrc')),
                "coverIncomingPath": str(staged_cover) if staged_cover else None, "coverPath": str(album_dir / 'cover.jpg'),
                "conflict": requested_target.exists(), "conflictAdjusted": target != requested_target, "overwrite": False,
                "plexRuleOk": True, "bytes": size,
            },
            "bytes": size,
            "quality": resolved_quality,
            "requestedQuality": quality,
            "qualityFallback": resolved_quality != quality,
            "source": resolved.get("sourceInfo") or {},
            "tagWarning": tag_warning,
            "lyrics": bool(lyric.strip()),
            "cover": bool(cover),
        }
    finally:
        temp_path.unlink(missing_ok=True)
        if staged_path and not keep_staged:
            staged_path.unlink(missing_ok=True)
        if staged_lrc and not keep_staged:
            staged_lrc.unlink(missing_ok=True)
        if staged_cover and not keep_staged:
            staged_cover.unlink(missing_ok=True)


def _validated_preview(payload: dict):
    preview = payload.get("preview") or {}
    incoming = Path(preview.get("incomingPath") or "").resolve()
    target = Path(preview.get("targetPath") or "").resolve()
    if settings.incoming_dir.resolve() not in incoming.parents:
        raise ValueError("待入库文件不在 _incoming 临时区")
    if settings.music_root.resolve() not in target.parents or settings.incoming_dir.resolve() in target.parents:
        raise ValueError("目标路径不是安全的正式曲库路径")
    if not incoming.exists():
        raise ValueError("待入库音频文件不存在")
    return preview, incoming, target


def confirm_download(payload: dict, progress):
    preview, incoming, target = _validated_preview(payload)
    progress(15, "入库预览已确认，开始移动音频文件")
    if target.exists():
        raise ValueError(f"目标文件已存在，请返回预览重新选择：{target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(incoming), str(target))
    lyric_in = Path(preview["lyricIncomingPath"]) if preview.get("lyricIncomingPath") else None
    cover_in = Path(preview["coverIncomingPath"]) if preview.get("coverIncomingPath") else None
    if lyric_in and lyric_in.exists():
        if settings.incoming_dir.resolve() not in lyric_in.resolve().parents: raise ValueError("歌词临时路径不安全")
        shutil.move(str(lyric_in), str(target.with_suffix(".lrc")))
    if cover_in and cover_in.exists():
        if settings.incoming_dir.resolve() not in cover_in.resolve().parents: raise ValueError("封面临时路径不安全")
        cover_target = target.parent / "cover.jpg"
        if not cover_target.exists(): shutil.move(str(cover_in), str(cover_target))
        else: cover_in.unlink(missing_ok=True)
    with transaction() as conn:
        conn.execute("INSERT INTO operation_logs(id,job_id,action,target_type,before_state,after_state,rollback_data,rollbackable,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (uuid.uuid4().hex,str(payload.get("downloadJobId") or ""),"download_ingest","file",json.dumps({"path":str(incoming)},ensure_ascii=False),json.dumps({"path":str(target)},ensure_ascii=False),json.dumps({"from":str(target),"to":str(incoming)},ensure_ascii=False),1,"success",now()))
    progress(82, "文件已移动到正式曲库，正在触发 Plex 扫描")
    try:
        plex.scan(); warning=""
    except Exception as exc:
        warning=f"歌曲已入库，但 Plex 扫描触发失败：{exc}"
    if payload.get("downloadJobId"):
        with transaction() as conn:
            conn.execute("UPDATE jobs SET status='completed',progress=100,message='已确认入库',finished_at=? WHERE id=?",(now(),int(payload["downloadJobId"])))
    return {"target":str(target),"plexWarning":warning,"ingested":True}


def cancel_download(payload: dict, progress):
    preview, incoming, target = _validated_preview(payload)
    trash = settings.download_trash_dir / f"download-{payload.get('downloadJobId') or uuid.uuid4().hex}"
    trash.mkdir(parents=True, exist_ok=True)
    moved=[]
    for key in ("incomingPath","lyricIncomingPath","coverIncomingPath"):
        value=preview.get(key)
        if not value: continue
        path=Path(value).resolve()
        if path.exists() and settings.incoming_dir.resolve() in path.parents:
            destination=trash/path.name;shutil.move(str(path),str(destination));moved.append(str(destination))
    progress(90,"待入库文件已移入音屿回收站")
    if payload.get("downloadJobId"):
        with transaction() as conn:
            conn.execute("UPDATE jobs SET status='cancelled',message='已取消入库',finished_at=? WHERE id=?",(now(),int(payload["downloadJobId"])))
    return {"cancelled":True,"trash":moved}
