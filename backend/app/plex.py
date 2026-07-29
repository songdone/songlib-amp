from __future__ import annotations

import re
import urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

import httpx

from .config import settings
from .db import get_kv, now


def has_chinese(text: str, minimum: int = 20) -> bool:
    return sum("\u4e00" <= char <= "\u9fff" for char in (text or "")) >= minimum


class PlexClient:
    def __init__(self):
        self._token = ""

    @staticmethod
    def saved_settings() -> dict:
        saved = get_kv("plex_settings", {}) or {}
        return {
            "enabled": bool(saved.get("enabled", True)),
            "name": saved.get("name") or "Plex",
            "serverUrl": (saved.get("serverUrl") or settings.plex_url).rstrip("/"),
            "externalUrl": (saved.get("externalUrl") or "").rstrip("/"),
            "token": saved.get("token") or "",
            "selectedLibraryKeys": saved.get("selectedLibraryKeys") or ([settings.plex_section] if settings.plex_section else "all"),
            "lastConnectedAt": saved.get("lastConnectedAt"),
            "lastSyncAt": saved.get("lastSyncAt"),
            "machineIdentifier": saved.get("machineIdentifier") or "",
        }

    @property
    def base_url(self):
        return self.saved_settings()["serverUrl"] or settings.plex_url

    @property
    def token(self):
        saved = self.saved_settings().get("token")
        if saved:
            return saved
        if not self._token:
            path = settings.preferences_path
            if not path.exists():
                raise RuntimeError(f"找不到 Plex Preferences.xml：{path}")
            root = ET.parse(path).getroot()
            self._token = root.attrib.get("PlexOnlineToken", "").strip()
            if not self._token:
                raise RuntimeError("Preferences.xml 中没有 PlexOnlineToken")
        return self._token

    def request(self, method: str, path: str, *, params=None, content=None, timeout=60, base_url=None, token=None):
        query = dict(params or {})
        token_value = token or self.token
        query["X-Plex-Token"] = token_value
        with httpx.Client(timeout=timeout) as client:
            response = client.request(
                method,
                (base_url or self.base_url) + path,
                params=query,
                content=content,
                headers={"X-Plex-Token": token_value},
            )
            response.raise_for_status()
            return response

    def xml(self, path: str, params=None, *, base_url=None, token=None):
        return ET.fromstring(self.request("GET", path, params=params, base_url=base_url, token=token).content)

    def libraries(self, *, base_url=None, token=None):
        root = self.xml("/library/sections", base_url=base_url, token=token)
        selected = self.saved_settings().get("selectedLibraryKeys")
        result = []
        for directory in root.findall(".//Directory"):
            item = dict(directory.attrib)
            lib_type = item.get("type") or ""
            is_music = lib_type in ("artist", "music")
            if not is_music:
                continue
            key = str(item.get("key") or "")
            result.append({
                "key": key,
                "title": item.get("title") or item.get("name") or f"音乐库 {key}",
                "type": "music" if lib_type == "artist" else lib_type,
                "enabled": selected == "all" or key in (selected or []),
            })
        return result

    def test_connection(self, *, base_url=None, token=None):
        identity = self.xml("/identity", base_url=base_url, token=token)
        libraries = self.libraries(base_url=base_url, token=token)
        return {
            "ok": True,
            "machineIdentifier": identity.attrib.get("machineIdentifier"),
            "friendlyName": identity.attrib.get("friendlyName") or identity.attrib.get("machineIdentifier") or "Plex",
            "libraryCount": len(libraries),
            "libraries": libraries,
            "connectedAt": now(),
        }

    def enabled_library_keys(self):
        selected = self.saved_settings().get("selectedLibraryKeys")
        if selected == "all":
            try:
                keys = [item["key"] for item in self.libraries()]
                return keys or ([settings.plex_section] if settings.plex_section else [])
            except Exception:
                return [settings.plex_section] if settings.plex_section else []
        if isinstance(selected, list):
            return [str(item) for item in selected if str(item)]
        if selected:
            return [str(selected)]
        return [settings.plex_section] if settings.plex_section else []

    def paged(self, media_type: int, *, limit=0, search=""):
        size = 500
        items = []
        for section in self.enabled_library_keys():
            start = 0
            while True:
                root = self.xml(
                    f"/library/sections/{section}/all",
                    {
                        "type": media_type,
                        "X-Plex-Container-Start": start,
                        "X-Plex-Container-Size": size,
                        "includeFields": 1,
                    },
                )
                page = [
                    {**self._element(item), "sectionKey": section}
                    for item in root
                    if item.attrib.get("ratingKey")
                ]
                items.extend(page)
                if len(page) < size or (limit and len(items) >= limit):
                    break
                start += len(page)
                if limit and len(items) >= limit:
                    break
        seen = set()
        deduped = []
        for item in items:
            key = item.get("ratingKey")
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        items = deduped
        if search:
            needle = search.casefold()
            fields = ("title", "parentTitle", "grandparentTitle", "originalTitle", "artist", "summary", "year")
            items = [
                item for item in items
                if any(needle in str(item.get(field) or "").casefold() for field in fields)
            ]
        return items[:limit] if limit else items

    def refresh_enabled_libraries(self):
        for section in self.enabled_library_keys():
            self.request("GET", f"/library/sections/{section}/refresh", timeout=20)
        return True

    def legacy_paged(self, media_type: int, *, limit=0, search=""):
        start = 0
        size = 500
        items = []
        while True:
            root = self.xml(
                f"/library/sections/{settings.plex_section}/all",
                {
                    "type": media_type,
                    "X-Plex-Container-Start": start,
                    "X-Plex-Container-Size": size,
                    "includeFields": 1,
                },
            )
            page = [self._element(item) for item in root if item.attrib.get("ratingKey")]
            items.extend(page)
            if len(page) < size or (limit and len(items) >= limit):
                break
            start += len(page)
        if search:
            needle = search.casefold()
            items = [item for item in items if needle in (item.get("title") or "").casefold()]
        return items[:limit] if limit else items

    def artists(self, **kwargs):
        return self.paged(8, **kwargs)

    def albums(self, **kwargs):
        return self.paged(9, **kwargs)

    def tracks(self, **kwargs):
        return self.paged(10, **kwargs)

    def playlists(self):
        root = self.xml("/playlists/all", {"playlistType": "audio"})
        return [dict(item.attrib) for item in root if item.attrib.get("ratingKey")]

    def playlist_items(self, rating_key: str):
        start = 0
        size = 500
        items = []
        while True:
            root = self.xml(
                f"/playlists/{rating_key}/items",
                {
                    "X-Plex-Container-Start": start,
                    "X-Plex-Container-Size": size,
                    "includeFields": 1,
                },
            )
            page = [
                self._element(item)
                for item in root
                if item.attrib.get("ratingKey")
            ]
            items.extend(page)
            if len(page) < size:
                break
            start += len(page)
        return items

    def replace_playlist(self, title: str, rating_keys: list[str]):
        keys = list(dict.fromkeys(str(key) for key in rating_keys if str(key)))
        if not keys:
            raise ValueError("没有可写入 Plex 的匹配歌曲")
        for item in self.playlists():
            if (item.get("title") or "").strip().casefold() == title.strip().casefold():
                self.request("DELETE", f"/playlists/{item['ratingKey']}")
        machine = self.saved_settings().get("machineIdentifier")
        if not machine:
            identity = self.xml("/identity")
            machine = identity.attrib.get("machineIdentifier")
        if not machine:
            raise RuntimeError("Plex 未返回服务器标识")
        uri = f"server://{machine}/com.plexapp.plugins.library/library/metadata/{','.join(keys)}"
        response = self.request(
            "POST",
            "/playlists",
            params={"type": "audio", "title": title, "smart": 0, "uri": uri},
        )
        root = ET.fromstring(response.content)
        created = next((dict(item.attrib) for item in root if item.attrib.get("ratingKey")), {})
        return {"title": title, "itemCount": len(keys), "ratingKey": created.get("ratingKey")}

    def metadata(self, rating_key: str):
        root = self.xml(f"/library/metadata/{rating_key}", {"includeFields": 1})
        element = next((child for child in root if child.attrib.get("ratingKey")), None)
        if element is None:
            raise RuntimeError("Plex 条目不存在")
        return self._element(element)

    def hierarchy(self, rating_key: str, suffix: str = "children"):
        if suffix not in ("children", "allLeaves"):
            raise ValueError("不支持的 Plex 层级查询")
        start = 0
        size = 500
        items = []
        while True:
            root = self.xml(
                f"/library/metadata/{rating_key}/{suffix}",
                {
                    "X-Plex-Container-Start": start,
                    "X-Plex-Container-Size": size,
                    "includeFields": 1,
                },
            )
            page = [
                self._element(item)
                for item in root
                if item.attrib.get("ratingKey")
            ]
            items.extend(page)
            if len(page) < size:
                break
            start += len(page)
        return items

    def children(self, rating_key: str):
        return self.hierarchy(rating_key, "children")

    def all_leaves(self, rating_key: str):
        return self.hierarchy(rating_key, "allLeaves")

    def playback(self, rating_key: str, bitrate: str = "original"):
        root = self.xml(f"/library/metadata/{rating_key}", {"includeFields": 1})
        element = next((child for child in root if child.attrib.get("ratingKey")), None)
        if element is None:
            raise RuntimeError("Plex 曲目不存在")
        item = self._element(element)
        part = element.find(".//Part")
        if part is None:
            raise RuntimeError("Plex 曲目没有可播放媒体文件")
        thumb = item.get("thumb")
        art = item.get("art") or item.get("parentThumb") or item.get("grandparentThumb")
        base = self.base_url
        original_url = base + part.attrib.get("key", "") + "?" + urllib.parse.urlencode({"X-Plex-Token": self.token})
        bitrate_map = {"320k": 320, "256k": 256, "192k": 192, "128k": 128}
        if bitrate in bitrate_map:
            transcode_path = "/music/:/transcode/universal/start.m3u8"
            stream_url = base + transcode_path + "?" + urllib.parse.urlencode({
                "path": f"/library/metadata/{rating_key}",
                "mediaIndex": 0,
                "partIndex": 0,
                "protocol": "hls",
                "maxAudioBitrate": bitrate_map[bitrate],
                "X-Plex-Token": self.token,
            })
            mode = "transcode"
        else:
            stream_url = original_url
            mode = "original"
        return {
            "source": "plex_item",
            "ratingKey": rating_key,
            "title": item.get("title") or "",
            "artist": item.get("grandparentTitle") or item.get("originalTitle") or item.get("artist") or "",
            "album": item.get("parentTitle") or "",
            "duration": int(item.get("duration") or 0),
            "file": part.attrib.get("file", ""),
            "thumb": thumb,
            "art": art,
            "thumbUrl": ("/api/plex/image?path=" + urllib.parse.quote(thumb, safe="")) if thumb else "",
            "artUrl": ("/api/plex/image?path=" + urllib.parse.quote(art, safe="")) if art else "",
            "streamUrl": stream_url,
            "mode": mode,
            "bitrate": bitrate,
            "qualities": ["original", "320k", "256k", "192k", "128k"],
        }

    def playback_info(self, rating_key: str):
        base = self.base_url
        info = self.playback(rating_key, "original")
        transcode_urls = {"original": f"/api/player/plex/{urllib.parse.quote(str(rating_key), safe='')}/stream?bitrate=original"}
        for bitrate in ("320k", "256k", "192k", "128k"):
            transcode_urls[bitrate] = f"/api/player/plex/{urllib.parse.quote(str(rating_key), safe='')}/stream?bitrate={bitrate}"
        lyrics = ""
        file_path = local_media_path(info.get("file") or "")
        if file_path and file_path.exists():
            lyric_path = file_path.with_suffix(".lrc")
            if lyric_path.exists():
                lyrics = lyric_path.read_text(encoding="utf-8", errors="ignore")
        saved = self.saved_settings()
        external = saved.get("externalUrl") or base
        mapped_path = local_media_path(info.get("file") or "")
        parts = []
        if mapped_path:
            try:
                parts = mapped_path.relative_to(settings.music_root).parts
            except Exception:
                parts = []
        inferred_artist = parts[0] if len(parts) >= 3 else ""
        inferred_album = re.sub(r"\s*[（(](?:19|20)\d{2}[)）]\s*$", "", parts[-2]).strip() if len(parts) >= 2 else ""
        raw_title = info["title"] or (mapped_path.stem if mapped_path else "")
        clean_title = re.sub(r"^\s*(?:cd\s*)?\d{1,3}[-_.、\s]+", "", raw_title, flags=re.I)
        clean_title = re.sub(r"\s*[-_.\s]+(?:official\s*)?(?:music\s*)?(?:video|mv)\s*$", "", clean_title, flags=re.I).strip(" -_.")
        halves = [value.strip() for value in re.split(r"\s+-\s+", clean_title) if value.strip()]
        if len(halves) == 2 and re.sub(r"\W+", "", halves[0].casefold()) == re.sub(r"\W+", "", halves[1].casefold()):
            clean_title = halves[0]
        return {
            "ratingKey": rating_key,
            "title": clean_title or raw_title,
            "artist": info["artist"] or inferred_artist,
            "album": info["album"] or inferred_album,
            "duration": info["duration"],
            "coverUrl": info.get("thumbUrl") or "",
            "artistBackgroundUrl": info.get("artUrl") or "",
            "directPlayUrl": transcode_urls["original"],
            "transcodeUrls": transcode_urls,
            "rawDirectPlayUrl": info["streamUrl"],
            "lyrics": lyrics,
            "file": info.get("file") or "",
            "openPlexUrl": (
                f"{external}/web/index.html#!/server/{saved.get('machineIdentifier')}/details?key=/library/metadata/{urllib.parse.quote(str(rating_key))}"
                if saved.get("machineIdentifier") else f"{external}/web/index.html#!/details?key=/library/metadata/{urllib.parse.quote(str(rating_key))}"
            ),
        }

    def first_track(self, rating_key: str):
        root = self.xml(
            f"/library/metadata/{rating_key}/allLeaves",
            {"X-Plex-Container-Start": 0, "X-Plex-Container-Size": 1},
        )
        part = root.find(".//Part")
        return part.attrib.get("file", "") if part is not None else ""

    def upload_poster(self, rating_key: str, data: bytes, media_type=8, section_key: str | None = None):
        self.request("POST", f"/library/metadata/{rating_key}/posters", content=data)
        self.edit(rating_key, media_type, {"thumb.locked": 1}, section_key)

    def upload_art(self, rating_key: str, data: bytes, section_key: str | None = None):
        self.request("POST", f"/library/metadata/{rating_key}/arts", content=data)
        self.edit(rating_key, 8, {"art.locked": 1}, section_key)

    def edit(self, rating_key: str, media_type: int, params: dict, section_key: str | None = None):
        payload = {"type": media_type, "id": rating_key, **params}
        section = str(section_key or settings.plex_section)
        self.request("PUT", f"/library/sections/{section}/all", params=payload)

    def scan(self):
        self.refresh_enabled_libraries()

    def image(self, path: str):
        if not path.startswith("/"):
            raise ValueError("非法 Plex 图片路径")
        return self.request("GET", path).content

    @staticmethod
    def _element(element):
        item = dict(element.attrib)
        tags = {}
        for child in element:
            value = child.attrib.get("tag")
            if value:
                tags.setdefault(child.tag.lower(), []).append(value)
        item["tags"] = tags
        part = element.find(".//Part")
        item["file"] = part.attrib.get("file", "") if part is not None else ""
        if part is not None:
            item["partId"] = part.attrib.get("id", "")
            item["partKey"] = part.attrib.get("key", "")
        return item


plex = PlexClient()


def local_media_path(plex_path: str) -> Path | None:
    if not plex_path.startswith(settings.plex_media_prefix):
        return None
    return settings.music_root / plex_path[len(settings.plex_media_prefix):]


BACKGROUND_FILENAMES = (
    "artist-background.jpg",
    "artist-background.jpeg",
    "artist-background.png",
    "artist-background.webp",
    "artist-bg.jpg",
    "artist-bg.jpeg",
    "artist-bg.png",
    "artist-bg.webp",
    "background.jpg",
    "background.jpeg",
    "background.png",
    "background.webp",
    "fanart.jpg",
    "fanart.jpeg",
    "fanart.png",
    "fanart.webp",
)


def local_artist_background_file(artist_name: str) -> Path | None:
    safe = (artist_name or "").replace("/", "_").replace("\\", "_").strip()
    if not safe:
        return None
    roots = (settings.music_root, settings.music_root / "library")
    for root in roots:
        artist_dir = root / safe
        if not artist_dir.exists() or not artist_dir.is_dir():
            continue
        for name in BACKGROUND_FILENAMES:
            candidate = artist_dir / name
            if candidate.exists() and candidate.is_file():
                return candidate
    return None


def _track_count(value) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _artist_track_counts(tracks: list[dict]) -> tuple[Counter, Counter]:
    by_key: Counter = Counter()
    by_title: Counter = Counter()
    for track in tracks:
        rating_key = str(track.get("grandparentRatingKey") or "").strip()
        title = str(
            track.get("grandparentTitle")
            or track.get("artist")
            or ""
        ).strip()
        if rating_key:
            by_key[rating_key] += 1
        if title:
            by_title[title.casefold()] += 1
    return by_key, by_title


def _ranked_artists(artists: list[dict], tracks: list[dict]) -> list[tuple[dict, int]]:
    by_key, by_title = _artist_track_counts(tracks)
    ranked = []
    for artist in artists:
        title = str(artist.get("title") or "").strip()
        rating_key = str(artist.get("ratingKey") or "").strip()
        count = max(
            _track_count(artist.get("leafCount")),
            by_key.get(rating_key, 0),
            by_title.get(title.casefold(), 0),
        )
        ranked.append((artist, count))
    return sorted(
        ranked,
        key=lambda item: (
            -item[1],
            str(item[0].get("title") or "").casefold(),
        ),
    )


def _local_background_items(
    limit: int,
    seen_titles: set[str],
    track_counts: Counter | None = None,
):
    items = []
    root = settings.music_root
    if not root.exists():
        return items
    track_counts = track_counts or Counter()
    roots = [root]
    read_only_root = root / "library"
    if read_only_root.exists() and read_only_root.is_dir():
        roots.append(read_only_root)
    directories = {
        path.name.casefold(): path
        for candidate_root in roots
        for path in candidate_root.iterdir()
        if path.is_dir() and path != read_only_root
    }
    artist_dirs = sorted(
        directories.values(),
        key=lambda path: (-track_counts.get(path.name.casefold(), 0), path.name.casefold()),
    )
    for artist_dir in artist_dirs:
        if len(items) >= limit:
            break
        title = artist_dir.name
        key = title.casefold()
        if key in seen_titles:
            continue
        background = local_artist_background_file(title)
        if not background:
            continue
        seen_titles.add(key)
        items.append({
            "type": "local_artist_background",
            "title": title,
            "subtitle": "本地 artist-background",
            "imageUrl": "/api/local/artists/" + urllib.parse.quote(title, safe="") + "/background",
            "coverUrl": "",
            "trackCount": track_counts.get(key, 0),
        })
    return items


def dashboard_stats():
    artists = plex.artists()
    albums = plex.albums()
    tracks = plex.tracks()
    audio_paths = []
    for track in tracks:
        path = local_media_path(track.get("file", ""))
        if path:
            audio_paths.append(path)
    lrc_count = sum(path.with_suffix(".lrc").exists() for path in audio_paths)
    hero_images = []
    seen_titles = set()
    ranked = _ranked_artists(artists, tracks)
    _, title_counts = _artist_track_counts(tracks)

    # Plex is the source of truth for the ambient artist-background deck.
    # Rank by the number of tracks in the connected Plex library and keep a
    # broad pool so the slideshow does not loop over the same handful.
    for item, count in ranked:
        title = item.get("title") or "未知歌手"
        image_path = item.get("art")
        if image_path:
            seen_titles.add(title.casefold())
            hero_images.append({
                "type": "plex_artist_background",
                "title": title,
                "subtitle": "Plex 歌手背景",
                "imageUrl": "/api/plex/image?path=" + urllib.parse.quote(image_path, safe=""),
                "coverUrl": "/api/plex/image?path=" + urllib.parse.quote(item.get("thumb") or image_path, safe=""),
                "trackCount": count,
            })
        if len(hero_images) >= 80:
            break

    # A mounted file is a fallback only when Plex exposes fewer than 80 artist
    # backgrounds.
    if len(hero_images) < 80:
        hero_images.extend(
            _local_background_items(
                80 - len(hero_images),
                seen_titles,
                title_counts,
            )
        )
    return {
        "artists": len(artists),
        "artistPosters": sum(bool(item.get("thumb")) for item in artists),
        "artistBackgrounds": sum(bool(item.get("art")) for item in artists),
        "chineseBios": sum(has_chinese(item.get("summary", "")) for item in artists),
        "albums": len(albums),
        "albumCovers": sum(bool(item.get("thumb")) for item in albums),
        "tracks": len(tracks),
        "localLyrics": lrc_count,
        "missingLyrics": max(0, len(audio_paths) - lrc_count),
        "musicRoot": str(settings.music_root),
        "plexConnected": True,
        "heroImages": hero_images,
    }
