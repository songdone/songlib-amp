from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path

from .local_library import clean_track_title, local_library, resolved_file_metadata
from .plex import plex


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold().replace("&", "and")
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)


def _plex_track(item: dict) -> dict:
    result = dict(item)
    artist = str(result.get("grandparentTitle") or result.get("originalTitle") or result.get("artist") or "").strip()
    album = str(result.get("parentTitle") or result.get("album") or "").strip()
    result.update({
        "title": clean_track_title(result.get("title") or Path(result.get("file") or "").stem, artist=artist, album=album),
        "artist": artist,
        "album": album,
    })
    return result


def _identity(title: str, artist: str, album: str = "") -> tuple[str, str, str]:
    return normalize(title), normalize(artist), normalize(album)


def _entity_seed(item: dict) -> dict:
    title = item.get("title") or "未命名歌曲"
    artist = item.get("artist") or ""
    album = item.get("album") or ""
    digest = hashlib.sha1("|".join(_identity(title, artist, album)).encode()).hexdigest()[:20]
    return {
        "id": f"track-{digest}",
        "canonicalKey": "|".join(_identity(title, artist, album)),
        "title": title,
        "artist": artist,
        "album": album,
        "duration": int(item.get("duration") or 0),
        "coverUrl": "",
        "resources": [],
    }


def _local_resource(item: dict) -> dict:
    return {
        "type": "local_file",
        "source": "local_file",
        "id": item.get("id"),
        "localFileId": item.get("id"),
        "path": item.get("path") or "",
        "format": str(item.get("ext") or item.get("format") or "").lstrip(".").upper(),
        "bitrate": int(item.get("bitrate") or 0),
        "sampleRate": int(item.get("sample_rate") or 0),
        "playable": True,
    }


def _plex_resource(item: dict) -> dict:
    return {
        "type": "plex_item",
        "source": "plex_item",
        "id": item.get("ratingKey"),
        "ratingKey": item.get("ratingKey"),
        "plexRatingKey": item.get("ratingKey"),
        "path": item.get("file") or "",
        "playable": True,
    }


def _choose_entity_metadata(entity: dict, local: dict | None, plex_item: dict | None) -> None:
    # Local written tags/path resolution are authoritative; Plex fills remaining gaps.
    entity["title"] = (local or {}).get("title") or (plex_item or {}).get("title") or entity["title"]
    entity["artist"] = (local or {}).get("artist") or (plex_item or {}).get("artist") or ""
    entity["album"] = (local or {}).get("album") or (plex_item or {}).get("album") or ""
    entity["duration"] = int((local or {}).get("duration") or round(int((plex_item or {}).get("duration") or 0) / 1000) or entity.get("duration") or 0)
    if local:
        entity["coverUrl"] = f"/api/local/files/{local['id']}/cover" if local.get("has_cover") else ""
    if not entity.get("coverUrl") and plex_item and plex_item.get("thumb"):
        from urllib.parse import quote
        entity["coverUrl"] = "/api/plex/image?path=" + quote(plex_item["thumb"], safe="")


def _find_match(entities: list[dict], item: dict, *, path: str = "") -> dict | None:
    wanted = _identity(item.get("title"), item.get("artist"), item.get("album"))
    norm_path = str(path or "").casefold()
    for entity in entities:
        if norm_path and any(str(resource.get("path") or "").casefold() == norm_path for resource in entity["resources"]):
            return entity
        key = _identity(entity.get("title"), entity.get("artist"), entity.get("album"))
        if wanted[0] and wanted[0] == key[0] and wanted[1] and wanted[1] == key[1]:
            return entity
        if wanted[0] and wanted[0] == key[0] and wanted[2] and wanted[2] == key[2] and (not wanted[1] or not key[1]):
            return entity
    return None


def unified_tracks(search: str = "", limit: int = 50, scopes=None) -> dict:
    limit = max(1, min(int(limit or 50), 200))
    local_data = local_library.list(search, "", min(max(limit * 3, 100), 1000), 0, scopes=scopes)
    local_items = [resolved_file_metadata(item) for item in local_data.get("items") or []]
    try:
        plex_items = [_plex_track(item) for item in plex.tracks(search=search)]
    except Exception:
        plex_items = []

    entities: list[dict] = []
    for item in local_items:
        entity = _entity_seed(item)
        entity["resources"].append(_local_resource(item))
        _choose_entity_metadata(entity, item, None)
        entities.append(entity)
    for item in plex_items:
        entity = _find_match(entities, item, path=item.get("file") or "")
        if not entity:
            entity = _entity_seed(item)
            entities.append(entity)
        if not any(resource["type"] == "plex_item" and str(resource.get("id")) == str(item.get("ratingKey")) for resource in entity["resources"]):
            entity["resources"].append(_plex_resource(item))
        local_item = next((candidate for candidate in local_items if any(resource.get("id") == candidate.get("id") for resource in entity["resources"])), None)
        _choose_entity_metadata(entity, local_item, item)

    for entity in entities:
        local_resource = next((item for item in entity["resources"] if item["type"] == "local_file"), None)
        plex_resource = next((item for item in entity["resources"] if item["type"] == "plex_item"), None)
        entity["preferredResource"] = local_resource or plex_resource
        entity["sourceTypes"] = [item["type"] for item in entity["resources"]]
        entity["matchStatus"] = "matched" if local_resource and plex_resource else ("local_only" if local_resource else "plex_only")
        entity["sourceSummary"] = " / ".join([
            f"本地 {local_resource.get('format') or '音频'}" if local_resource else "",
            "Plex" if plex_resource else "",
        ]).strip(" / ")
        entity["canonicalKey"] = "|".join(_identity(entity["title"], entity["artist"], entity["album"]))

    entities.sort(key=lambda item: (0 if item["matchStatus"] == "matched" else 1, normalize(item.get("artist")), normalize(item.get("album")), normalize(item.get("title"))))
    return {"items": entities[:limit], "total": len(entities), "query": search}


def catalog_index(scopes=None) -> tuple[dict, dict]:
    """Build lightweight exact indexes for matching external playlist tracks."""
    entities = []
    offset = 0
    while True:
        page = local_library.list("", "", 1000, offset, scopes=scopes)
        if not page.get("items"):
            break
        for raw in page["items"]:
            item = resolved_file_metadata(raw)
            if _find_match(entities, item, path=item.get("path") or ""):
                continue
            entity = _entity_seed(item)
            entity["resources"] = [_local_resource(item)]
            entity["preferredResource"] = entity["resources"][0]
            entity["sourceTypes"] = ["local_file"]
            entity["matchStatus"] = "local_only"
            entity["sourceSummary"] = f"本地 {entity['resources'][0].get('format') or '音频'}"
            _choose_entity_metadata(entity, item, None)
            entities.append(entity)
        offset += len(page["items"])
        if len(page["items"]) < 1000:
            break
    try:
        for raw in plex.tracks(search=""):
            item = _plex_track(raw)
            entity = _find_match(entities, item, path=item.get("file") or "")
            if not entity:
                entity = _entity_seed(item)
                entities.append(entity)
            entity["resources"].append(_plex_resource(item))
            if not entity.get("preferredResource"):
                entity["preferredResource"] = entity["resources"][0]
            entity["sourceTypes"] = list(dict.fromkeys(resource["type"] for resource in entity["resources"]))
            entity["matchStatus"] = "matched" if {resource["type"] for resource in entity["resources"]} >= {"local_file", "plex_item"} else "plex_only"
            entity["sourceSummary"] = "本地 / Plex" if entity["matchStatus"] == "matched" else "Plex"
            local_metadata = dict(entity) if any(resource["type"] == "local_file" for resource in entity["resources"]) else None
            _choose_entity_metadata(entity, local_metadata, item)
    except Exception:
        pass
    strong, title_only = {}, {}
    for entity in entities:
        title, artist, _ = _identity(entity.get("title"), entity.get("artist"), entity.get("album"))
        if title and artist:
            strong.setdefault((title, artist), entity)
        if title:
            title_only.setdefault(title, []).append(entity)
    return strong, title_only


def match_external_tracks(tracks: list[dict], scopes=None) -> list[dict]:
    strong, title_only = catalog_index(scopes=scopes)
    output = []
    for item in tracks:
        title = clean_track_title(item.get("title") or item.get("name") or "")
        artist = str(item.get("artist") or "").strip()
        primary_artist = re.split(r"\s*(?:/|&|、|,|，| feat\.? | ft\.? )\s*", artist, maxsplit=1, flags=re.I)[0].strip()
        key = (normalize(title), normalize(artist))
        entity = strong.get(key)
        if not entity and primary_artist and normalize(primary_artist) != key[1]:
            entity = strong.get((key[0], normalize(primary_artist)))
        if not entity:
            candidates = title_only.get(key[0]) or []
            if not artist and len(candidates) == 1:
                entity = candidates[0]
        wanted_duration = int(item.get("duration") or 0)
        actual_duration = int((entity or {}).get("duration") or 0)
        if entity and wanted_duration and actual_duration and abs(wanted_duration - actual_duration) > 4:
            entity = None
        output.append({
            **item,
            "title": title,
            "artist": artist,
            "matchStatus": "matched" if entity else "missing",
            "localTrack": entity,
            "preferredResource": (entity or {}).get("preferredResource"),
        })
    return output
