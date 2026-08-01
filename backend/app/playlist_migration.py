from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from .network import validate_public_url
from .playlists import create_playlist, list_playlists, update_playlist
from .plex import plex
from .unified_catalog import match_external_tracks, normalize


ALLOWED_HOSTS = {
    "music.163.com",
    "music.126.net",
    "y.qq.com",
    "i.y.qq.com",
    "c.y.qq.com",
    "c6.y.qq.com",
    "url.cn",
}


def _allowed_host(hostname: str) -> bool:
    host = (hostname or "").casefold().strip(".")
    return any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_HOSTS)


def _resolve_share_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not _allowed_host(parsed.hostname or ""):
        raise ValueError("仅支持 QQ 音乐或网易云音乐的公开歌单分享链接")
    validate_public_url(url, label="歌单分享链接")
    direct_params = {
        **parse_qs(urlparse(parsed.fragment).query),
        **parse_qs(parsed.query),
    }
    direct_id = (
        direct_params.get("id")
        or direct_params.get("disstid")
        or [None]
    )[0]
    if (
        direct_id
        and str(direct_id).isdigit()
        or re.search(r"/playlist/\d+", parsed.path)
    ):
        return url
    for _ in range(5):
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.get(url, headers={"User-Agent": "Mozilla/5.0 SongLib-Amp/1.0"})
        if response.status_code not in {301, 302, 303, 307, 308}:
            return str(response.url)
        target = urljoin(url, response.headers.get("location") or "")
        parsed_target = urlparse(target)
        if not _allowed_host(parsed_target.hostname or ""):
            raise ValueError("歌单链接跳转到了不受信任的站点")
        validate_public_url(target, label="歌单跳转链接")
        url = target
    raise ValueError("歌单分享链接跳转次数过多")


def detect_share_link(value: str) -> dict:
    url = _resolve_share_url(value)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    fragment_query = parse_qs(urlparse(parsed.fragment).query)
    params = {**fragment_query, **query}
    if "163.com" in (parsed.hostname or ""):
        match = re.search(r"(?:playlist/|playlist\?id=)(\d+)", url)
        playlist_id = (params.get("id") or [None])[0] or (match.group(1) if match else None)
        if not playlist_id or not str(playlist_id).isdigit():
            raise ValueError("没有从网易云音乐链接中识别到歌单编号")
        return {"platform": "netease", "platformLabel": "网易云音乐", "playlistId": str(playlist_id), "sourceUrl": url}
    match = re.search(r"/playlist/(\d+)", parsed.path)
    playlist_id = (params.get("id") or params.get("disstid") or [None])[0] or (match.group(1) if match else None)
    if not playlist_id or not str(playlist_id).isdigit():
        raise ValueError("没有从 QQ 音乐链接中识别到歌单编号")
    return {"platform": "qq", "platformLabel": "QQ 音乐", "playlistId": str(playlist_id), "sourceUrl": url}


def _netease_playlist(playlist_id: str) -> dict:
    headers = {"User-Agent": "Mozilla/5.0 SongLib-Amp/1.0", "Referer": "https://music.163.com/"}
    with httpx.Client(timeout=httpx.Timeout(10, read=18), follow_redirects=False) as client:
        response = client.get(
            "https://music.163.com/api/v6/playlist/detail",
            params={"id": playlist_id, "n": 1000, "s": 0},
            headers=headers,
        )
        response.raise_for_status()
        playlist = (response.json().get("playlist") or {})
        tracks = list(playlist.get("tracks") or [])
        known = {str(item.get("id")) for item in tracks if item.get("id")}
        missing = [str(item.get("id")) for item in (playlist.get("trackIds") or []) if item.get("id") and str(item.get("id")) not in known][:2_000]
        for start in range(0, len(missing), 100):
            detail = client.get(
                "https://music.163.com/api/song/detail",
                params={"ids": json.dumps(missing[start:start + 100])},
                headers=headers,
            )
            detail.raise_for_status()
            tracks.extend(detail.json().get("songs") or [])
    normalized = []
    for item in tracks[:2_000]:
        artists = item.get("ar") or item.get("artists") or []
        album = item.get("al") or item.get("album") or {}
        normalized.append({
            "platform": "wy",
            "platformTrackId": str(item.get("id") or ""),
            "externalRef": f"netease:{item.get('id')}",
            "title": item.get("name") or "",
            "artist": " / ".join(filter(None, [artist.get("name") for artist in artists])),
            "album": album.get("name") or "",
            "duration": round(int(item.get("dt") or item.get("duration") or 0) / 1000),
            "coverUrl": album.get("picUrl") or "",
        })
    return {
        "name": playlist.get("name") or f"网易云歌单 {playlist_id}",
        "description": re.sub(r"\s+", " ", playlist.get("description") or "").strip()[:500],
        "coverUrl": playlist.get("coverImgUrl") or "",
        "tracks": normalized,
    }


def _json_or_jsonp(response: httpx.Response) -> dict:
    text = response.text.strip()
    try:
        return response.json()
    except json.JSONDecodeError:
        match = re.search(r"^[^(]*\((.*)\)\s*;?$", text, flags=re.S)
        if not match:
            raise ValueError("QQ 音乐返回了无法识别的数据")
        return json.loads(match.group(1))


def _qq_playlist(playlist_id: str) -> dict:
    with httpx.Client(timeout=httpx.Timeout(10, read=18), follow_redirects=False) as client:
        response = client.get(
            "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
            params={
                "type": 1,
                "json": 1,
                "utf8": 1,
                "onlysong": 0,
                "disstid": playlist_id,
                "format": "json",
            },
            headers={
                "User-Agent": "Mozilla/5.0 SongLib-Amp/1.0",
                "Referer": f"https://y.qq.com/n/ryqq/playlist/{playlist_id}",
            },
        )
        response.raise_for_status()
    data = _json_or_jsonp(response)
    playlist = (data.get("cdlist") or [{}])[0]
    tracks = []
    for item in (playlist.get("songlist") or [])[:2_000]:
        singers = item.get("singer") or []
        album_mid = item.get("albummid") or ""
        tracks.append({
            "platform": "tx",
            "platformTrackId": str(item.get("songmid") or item.get("songid") or ""),
            "externalRef": f"qq:{item.get('songmid') or item.get('songid')}",
            "title": item.get("songname") or item.get("name") or "",
            "artist": " / ".join(filter(None, [singer.get("name") for singer in singers])),
            "album": item.get("albumname") or "",
            "duration": int(item.get("interval") or 0),
            "coverUrl": f"https://y.gtimg.cn/music/photo_new/T002R500x500M000{album_mid}.jpg" if album_mid else "",
        })
    return {
        "name": playlist.get("dissname") or f"QQ 音乐歌单 {playlist_id}",
        "description": re.sub(r"\s+", " ", playlist.get("desc") or "").strip()[:500],
        "coverUrl": playlist.get("logo") or "",
        "tracks": tracks,
    }


def preview_share_link(value: str, scopes=None) -> dict:
    link = detect_share_link(value)
    raw = _netease_playlist(link["playlistId"]) if link["platform"] == "netease" else _qq_playlist(link["playlistId"])
    tracks = match_external_tracks(raw["tracks"], scopes=scopes)
    for item in tracks:
        entity = item.get("localTrack") or {}
        resources = entity.get("resources") or []
        item["localFileId"] = next((resource.get("localFileId") for resource in resources if resource.get("localFileId")), None)
        item["plexRatingKey"] = next((resource.get("plexRatingKey") for resource in resources if resource.get("plexRatingKey")), None)
        item.pop("localTrack", None)
    return {
        "platform": link["platform"],
        "platformLabel": link["platformLabel"],
        "playlistId": link["playlistId"],
        "sourceUrl": link["sourceUrl"],
        "name": raw["name"],
        "description": raw["description"],
        "coverUrl": raw["coverUrl"],
        "tracks": tracks,
        "summary": {
            "total": len(tracks),
            "matched": len([item for item in tracks if item["matchStatus"] == "matched"]),
            "missing": len([item for item in tracks if item["matchStatus"] != "matched"]),
            "plexReady": len([item for item in tracks if item.get("plexRatingKey")]),
        },
    }


def import_to_songlib(user_id: str, preview: dict):
    items = []
    for item in preview.get("tracks") or []:
        items.append({
            "fileId": item.get("localFileId"),
            "externalRef": item.get("externalRef"),
            "title": item.get("title"),
            "artist": item.get("artist"),
            "album": item.get("album"),
            "duration": item.get("duration"),
        })
    existing = next(
        (
            item for item in list_playlists(user_id)
            if item.get("source_ref") == preview.get("sourceUrl")
            or (item.get("name") or "").casefold() == (preview.get("name") or "").casefold()
        ),
        None,
    )
    if existing:
        return update_playlist(
            existing["id"],
            user_id,
            name=preview.get("name") or existing["name"],
            description=preview.get("description") or "",
            items=items,
        )
    return create_playlist(
        user_id,
        preview.get("name") or "导入歌单",
        preview.get("description") or "",
        items,
        source_kind=preview.get("platform") or "share_link",
        source_ref=preview.get("sourceUrl"),
        cover_ref=preview.get("coverUrl"),
    )


def export_to_plex(preview: dict):
    keys = [str(item.get("plexRatingKey")) for item in preview.get("tracks") or [] if item.get("plexRatingKey")]
    return plex.replace_playlist(preview.get("name") or "SongLib 歌单", keys)


def strict_candidate(track: dict, candidates: list[dict]) -> dict | None:
    wanted_title = normalize(track.get("title"))
    wanted_artist = normalize(str(track.get("artist") or "").split("/", 1)[0])
    wanted_duration = int(track.get("duration") or 0)
    for item in candidates:
        title = normalize(item.get("title"))
        artist = normalize(str(item.get("artist") or "").split("/", 1)[0])
        duration = int(item.get("duration") or 0)
        if title != wanted_title or (wanted_artist and artist != wanted_artist):
            continue
        if wanted_duration and duration and abs(wanted_duration - duration) > 4:
            continue
        return item
    return None
