from __future__ import annotations

import hashlib
import json
import random
import time
from urllib.parse import parse_qsl, unquote, urlencode, urlparse

import httpx

from .config import settings
from .unified_catalog import normalize


SIGNING_SEED = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh"
CLIENT_API_KEY = "6D5602D4-A342-4799-A0F0-BB795E7167D0"


class FnosMusicClient:
    @property
    def configured(self) -> bool:
        return bool(settings.fnos_music_url and settings.fnos_music_token)

    @property
    def base_url(self) -> str:
        if not settings.fnos_music_url:
            raise RuntimeError("尚未配置飞牛音乐地址")
        return settings.fnos_music_url.rstrip("/") + "/api/v1"

    def _authx(self, method: str, url: str, data: dict | None) -> str:
        parsed = urlparse(url)
        if method.upper() == "GET":
            pairs = sorted(parse_qsl(parsed.query, keep_blank_values=True))
            canonical = urlencode(pairs).replace("+", "%20")
            body_hash = hashlib.md5(unquote(canonical).encode("utf-8")).hexdigest()
        else:
            canonical = "" if data is None else json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            body_hash = hashlib.md5(canonical.encode("utf-8")).hexdigest()
        nonce = str(random.randint(100000, 999999))
        timestamp = str(int(time.time() * 1000))
        material = "_".join((SIGNING_SEED, parsed.path, nonce, timestamp, body_hash, CLIENT_API_KEY))
        signature = hashlib.md5(material.encode("utf-8")).hexdigest()
        return f"nonce={nonce}&timestamp={timestamp}&sign={signature}"

    def request(self, method: str, path: str, *, params: dict | None = None, data: dict | None = None):
        if not self.configured:
            raise RuntimeError("飞牛音乐连接尚未配置服务令牌")
        url = self.base_url + path
        if params:
            url += "?" + urlencode(params)
        headers = {
            "authx": self._authx(method, url, data),
            "Cookie": f"music-token={settings.fnos_music_token}",
            "Accept": "application/json",
        }
        with httpx.Client(timeout=httpx.Timeout(8, read=30), follow_redirects=False) as client:
            response = client.request(
                method,
                url,
                json=data if method.upper() != "GET" else None,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
        if isinstance(payload, dict) and payload.get("code") not in (None, 0, 200):
            raise RuntimeError(payload.get("msg") or f"飞牛音乐接口返回错误 {payload.get('code')}")
        return payload.get("data") if isinstance(payload, dict) and "data" in payload else payload

    def test(self):
        data = self.request("GET", "/playlist/list")
        return {"ok": True, "playlistCount": len((data or {}).get("list") or [])}

    def _strict_track_guid(self, track: dict) -> str | None:
        data = self.request(
            "GET",
            "/search/track",
            params={"q": f"{track.get('title', '')} {str(track.get('artist') or '').split('/', 1)[0]}".strip(), "page": 1, "size": 30},
        )
        wanted_title = normalize(track.get("title"))
        wanted_artist = normalize(str(track.get("artist") or "").split("/", 1)[0])
        wanted_duration = int(track.get("duration") or 0)
        for item in (data or {}).get("list") or []:
            artists = item.get("artists") or []
            artist = " / ".join(str(value.get("name") or "") for value in artists if isinstance(value, dict))
            duration = round(int(item.get("duration") or 0) / 1000)
            if normalize(item.get("title")) != wanted_title:
                continue
            if wanted_artist and normalize(artist.split("/", 1)[0]) != wanted_artist:
                continue
            if wanted_duration and duration and abs(wanted_duration - duration) > 4:
                continue
            return str(item.get("guid") or "") or None
        return None

    def replace_playlist(self, title: str, tracks: list[dict]):
        listing = self.request("GET", "/playlist/list") or {}
        for item in listing.get("list") or []:
            if (item.get("name") or "").strip().casefold() == title.strip().casefold():
                self.request("POST", "/playlist/delete", data={"guid": item.get("guid")})
        created = self.request("POST", "/playlist/create", data={"name": title, "coverId": None}) or {}
        guid = created.get("guid")
        if not guid:
            raise RuntimeError("飞牛音乐没有返回新歌单编号")
        matched = []
        missing = []
        for track in tracks:
            track_guid = self._strict_track_guid(track)
            if track_guid:
                matched.append(track_guid)
            else:
                missing.append({"title": track.get("title"), "artist": track.get("artist")})
        for start in range(0, len(matched), 500):
            self.request(
                "POST",
                "/playlist/add-track",
                data={"guid": guid, "trackGUIDs": matched[start:start + 500]},
            )
        return {"ok": True, "guid": guid, "title": title, "matched": len(matched), "missing": missing}


fnos_music = FnosMusicClient()
