from __future__ import annotations

import hashlib
import json
import os
import random
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlparse

import httpx

from .config import settings
from .unified_catalog import normalize


# Public client identifiers embedded in the fnOS Music web application.
# They sign requests but are not credentials. User credentials and derived
# service tokens are never committed to the repository.
PUBLIC_SIGNING_SEED = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh"
PUBLIC_CLIENT_ID = "6D5602D4-A342-4799-A0F0-BB795E7167D0"


class FnosMusicClient:
    @property
    def secret_file(self) -> Path:
        return settings.data_dir / "secrets" / "fnos-music.json"

    def _saved(self) -> dict:
        try:
            payload = json.loads(self.secret_file.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (FileNotFoundError, OSError, ValueError):
            return {}

    @property
    def server_url(self) -> str:
        return str(
            self._saved().get("serverUrl") or settings.fnos_music_url or ""
        ).strip().rstrip("/")

    @property
    def token(self) -> str:
        return str(
            self._saved().get("token") or settings.fnos_music_token or ""
        ).strip()

    @property
    def configured(self) -> bool:
        return bool(self.server_url and self.token)

    def public_settings(self) -> dict:
        saved = self._saved()
        return {
            "configured": self.configured,
            "serverUrl": self.server_url,
            "authMode": saved.get("authMode")
            or ("token" if settings.fnos_music_token else "password"),
            "accountLabel": saved.get("username") or "",
            "passwordStored": False,
        }

    def _save_secret(
        self,
        *,
        server_url: str,
        token: str,
        auth_mode: str,
        username: str = "",
    ) -> None:
        target = self.secret_file
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(target.parent, 0o700)
        except OSError:
            pass
        temporary = target.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                {
                    "serverUrl": server_url.rstrip("/"),
                    "token": token,
                    "authMode": auth_mode,
                    "username": username,
                    "updatedAt": int(time.time()),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        temporary.replace(target)
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass

    @staticmethod
    def _api_base(server_url: str) -> str:
        base = (server_url or "").strip().rstrip("/")
        if base.endswith("/music"):
            return base + "/api/v1"
        return base + "/music/api/v1"

    @property
    def base_url(self) -> str:
        if not self.server_url:
            raise RuntimeError("尚未配置飞牛音乐地址")
        return self._api_base(self.server_url)

    def _authx(self, method: str, url: str, data: dict | None) -> str:
        parsed = urlparse(url)
        if method.upper() == "GET":
            pairs = sorted(parse_qsl(parsed.query, keep_blank_values=True))
            canonical = urlencode(pairs).replace("+", "%20")
            body_hash = hashlib.md5(unquote(canonical).encode("utf-8")).hexdigest()
        else:
            canonical = (
                ""
                if data is None
                else json.dumps(
                    data, ensure_ascii=False, separators=(",", ":")
                )
            )
            body_hash = hashlib.md5(canonical.encode("utf-8")).hexdigest()
        nonce = str(random.randint(100000, 999999))
        timestamp = str(int(time.time() * 1000))
        material = "_".join(
            (
                PUBLIC_SIGNING_SEED,
                parsed.path,
                nonce,
                timestamp,
                body_hash,
                PUBLIC_CLIENT_ID,
            )
        )
        signature = hashlib.md5(material.encode("utf-8")).hexdigest()
        return f"nonce={nonce}&timestamp={timestamp}&sign={signature}"

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        data: dict | None = None,
        server_url: str | None = None,
        token: str | None = None,
        require_token: bool = True,
    ):
        resolved_server = (server_url or self.server_url).strip().rstrip("/")
        resolved_token = self.token if token is None else token.strip()
        if not resolved_server:
            raise RuntimeError("尚未配置飞牛音乐地址")
        if require_token and not resolved_token:
            raise RuntimeError("飞牛音乐连接尚未配置服务令牌")
        url = self._api_base(resolved_server) + path
        if params:
            url += "?" + urlencode(params)
        headers = {
            "authx": self._authx(method, url, data),
            "Accept": "application/json",
        }
        if resolved_token:
            headers["Cookie"] = f"music-token={resolved_token}"
        with httpx.Client(
            timeout=httpx.Timeout(8, read=30), follow_redirects=False
        ) as client:
            response = client.request(
                method,
                url,
                json=data if method.upper() != "GET" else None,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
        if isinstance(payload, dict) and payload.get("code") not in (
            None,
            0,
            200,
        ):
            raise RuntimeError(
                payload.get("msg")
                or f"飞牛音乐接口返回错误 {payload.get('code')}"
            )
        return (
            payload.get("data")
            if isinstance(payload, dict) and "data" in payload
            else payload
        )

    def configure(
        self,
        *,
        server_url: str,
        auth_mode: str,
        username: str = "",
        password: str = "",
        token: str = "",
    ) -> dict:
        server_url = server_url.strip().rstrip("/")
        if auth_mode == "password":
            username = username.strip()
            if not username or not password:
                raise ValueError("请输入飞牛音乐账号和密码")
            try:
                result = self.request(
                    "POST",
                    "/user/password-login",
                    data={
                        "username": username,
                        "password": hashlib.sha256(
                            password.encode("utf-8")
                        ).hexdigest(),
                        "deviceId": uuid.uuid4().hex,
                    },
                    server_url=server_url,
                    token="",
                    require_token=False,
                )
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in (401, 403):
                    raise RuntimeError(
                        "飞牛音乐账号或密码错误，或密码登录未启用"
                    ) from exc
                raise
            token = str((result or {}).get("userToken") or "").strip()
            if not token:
                raise RuntimeError("飞牛音乐未返回可用的服务会话")
        else:
            token = token.strip()
            if not token:
                raise ValueError("请输入飞牛音乐服务令牌")
            username = ""
        self.request(
            "GET",
            "/playlist/list",
            server_url=server_url,
            token=token,
        )
        self._save_secret(
            server_url=server_url,
            token=token,
            auth_mode=auth_mode,
            username=username,
        )
        return self.public_settings()

    def test(self):
        data = self.request("GET", "/playlist/list")
        return {
            "ok": True,
            "playlistCount": len((data or {}).get("list") or []),
        }

    def _strict_track_guid(self, track: dict) -> str | None:
        data = self.request(
            "GET",
            "/search/track",
            params={
                "q": (
                    f"{track.get('title', '')} "
                    f"{str(track.get('artist') or '').split('/', 1)[0]}"
                ).strip(),
                "page": 1,
                "size": 30,
            },
        )
        wanted_title = normalize(track.get("title"))
        wanted_artist = normalize(
            str(track.get("artist") or "").split("/", 1)[0]
        )
        wanted_duration = int(track.get("duration") or 0)
        for item in (data or {}).get("list") or []:
            artists = item.get("artists") or []
            artist = " / ".join(
                str(value.get("name") or "")
                for value in artists
                if isinstance(value, dict)
            )
            duration = round(int(item.get("duration") or 0) / 1000)
            if normalize(item.get("title")) != wanted_title:
                continue
            if (
                wanted_artist
                and normalize(artist.split("/", 1)[0]) != wanted_artist
            ):
                continue
            if (
                wanted_duration
                and duration
                and abs(wanted_duration - duration) > 4
            ):
                continue
            return str(item.get("guid") or "") or None
        return None

    def replace_playlist(self, title: str, tracks: list[dict]):
        listing = self.request("GET", "/playlist/list") or {}
        for item in listing.get("list") or []:
            if (item.get("name") or "").strip().casefold() == (
                title.strip().casefold()
            ):
                self.request(
                    "POST",
                    "/playlist/delete",
                    data={"guid": item.get("guid")},
                )
        created = self.request(
            "POST", "/playlist/create", data={"name": title, "coverId": None}
        ) or {}
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
                missing.append(
                    {
                        "title": track.get("title"),
                        "artist": track.get("artist"),
                    }
                )
        for start in range(0, len(matched), 500):
            self.request(
                "POST",
                "/playlist/add-track",
                data={"guid": guid, "trackGUIDs": matched[start : start + 500]},
            )
        return {
            "ok": True,
            "guid": guid,
            "title": title,
            "matched": len(matched),
            "missing": missing,
        }


fnos_music = FnosMusicClient()
