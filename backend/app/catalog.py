from __future__ import annotations

import html
import urllib.parse

import httpx


HEADERS_QQ = {"User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com/"}
HEADERS_NE = {"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"}


def _get_json(url: str, headers: dict):
    with httpx.Client(timeout=25, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()


def qq_song_detail(mid: str):
    url = "https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=" + urllib.parse.quote(mid) + "&format=json"
    data = _get_json(url, HEADERS_QQ)
    return (data.get("data") or [None])[0]


def search_qq(query: str):
    url = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&key=" + urllib.parse.quote(query)
    items = _get_json(url, HEADERS_QQ).get("data", {}).get("song", {}).get("itemlist", [])
    results = []
    for item in items[:12]:
        try:
            detail = qq_song_detail(item["mid"])
        except Exception:
            detail = None
        if not detail:
            continue
        file_info = detail.get("file") or {}
        singers = "/".join(s.get("name", "") for s in detail.get("singer") or [])
        qualitys = []
        quality_map = {
            "128k": file_info.get("size_128mp3", 0),
            "320k": file_info.get("size_320mp3", 0),
            "flac": file_info.get("size_flac", 0),
            "flac24bit": file_info.get("size_hires", 0),
        }
        for quality, size in quality_map.items():
            if size:
                qualitys.append({"type": quality, "size": size})
        album = detail.get("album") or {}
        music_info = {
            "id": f"tx_{detail.get('mid')}",
            "name": detail.get("name", ""),
            "singer": singers,
            "source": "tx",
            "interval": f"{int(detail.get('interval') or 0)//60:02d}:{int(detail.get('interval') or 0)%60:02d}",
            "songmid": detail.get("mid"),
            "songId": detail.get("id"),
            "albumId": album.get("mid") or album.get("id"),
            "albumName": album.get("name", ""),
            "img": f"https://y.gtimg.cn/music/photo_new/T002R800x800M000{album.get('mid')}.jpg" if album.get("mid") else "",
            "strMediaMid": file_info.get("media_mid") or detail.get("mid"),
            "types": [{"type": q["type"], "size": str(q["size"])} for q in qualitys],
            "meta": {
                "songId": detail.get("mid"),
                "id": detail.get("id"),
                "albumName": album.get("name", ""),
                "albumId": album.get("id"),
                "albumMid": album.get("mid"),
                "picUrl": f"https://y.gtimg.cn/music/photo_new/T002R800x800M000{album.get('mid')}.jpg" if album.get("mid") else "",
                "strMediaMid": file_info.get("media_mid") or detail.get("mid"),
                "qualitys": [{"type": q["type"], "size": str(q["size"])} for q in qualitys],
                "_qualitys": {q["type"]: {"size": str(q["size"])} for q in qualitys},
            },
        }
        results.append({
            "platform": "tx",
            "id": detail.get("mid"),
            "title": detail.get("name", ""),
            "artist": singers,
            "album": album.get("name", ""),
            "duration": detail.get("interval") or 0,
            "cover": music_info["meta"]["picUrl"],
            "qualities": [q["type"] for q in qualitys],
            "musicInfo": music_info,
        })
    return results


def search_netease(query: str):
    url = (
        "https://music.163.com/api/search/get/web?s=" + urllib.parse.quote(query)
        + "&type=1&limit=20&offset=0"
    )
    items = _get_json(url, HEADERS_NE).get("result", {}).get("songs", [])
    results = []
    for item in items:
        artists = item.get("artists") or item.get("ar") or []
        album = item.get("album") or item.get("al") or {}
        singer = "/".join(artist.get("name", "") for artist in artists)
        duration_ms = item.get("duration") or item.get("dt") or 0
        qualitys = ["128k", "320k", "flac", "flac24bit"]
        music_info = {
            "id": f"wy_{item.get('id')}",
            "name": item.get("name", ""),
            "singer": singer,
            "source": "wy",
            "interval": f"{int(duration_ms/1000)//60:02d}:{int(duration_ms/1000)%60:02d}",
            "songmid": item.get("id"),
            "albumId": album.get("id"),
            "albumName": album.get("name", ""),
            "img": album.get("picUrl", ""),
            "types": [{"type": quality, "size": None} for quality in qualitys],
            "meta": {
                "songId": item.get("id"),
                "albumName": album.get("name", ""),
                "albumId": album.get("id"),
                "picUrl": album.get("picUrl", ""),
                "qualitys": [{"type": quality, "size": None} for quality in qualitys],
                "_qualitys": {quality: {"size": None} for quality in qualitys},
            },
        }
        results.append({
            "platform": "wy",
            "id": str(item.get("id")),
            "title": item.get("name", ""),
            "artist": singer,
            "album": album.get("name", ""),
            "duration": int(duration_ms / 1000),
            "cover": album.get("picUrl", ""),
            "qualities": qualitys,
            "musicInfo": music_info,
        })
    return results


def search(query: str, platform: str):
    query = html.unescape(query).strip()
    if not query:
        return []
    if platform == "tx":
        return search_qq(query)
    if platform == "wy":
        return search_netease(query)
    raise ValueError("不支持的搜索平台")


def lyrics_for(item: dict):
    platform = item.get("platform")
    song_id = item.get("id")
    if platform == "tx":
        url = (
            "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid="
            + urllib.parse.quote(str(song_id))
            + "&format=json&nobase64=1"
        )
        return _get_json(url, HEADERS_QQ).get("lyric") or ""
    if platform == "wy":
        url = f"https://music.163.com/api/song/lyric?id={song_id}&lv=1&kv=1&tv=1&rv=1"
        return (_get_json(url, HEADERS_NE).get("lrc") or {}).get("lyric") or ""
    return ""
