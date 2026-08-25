from __future__ import annotations

import ipaddress
import threading
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET

import httpx

from .db import get_kv, set_kv
from .plex import plex


PLAYBACK_COMMANDS = {
    "play": "/player/playback/play",
    "pause": "/player/playback/pause",
    "stop": "/player/playback/stop",
    "previous": "/player/playback/skipPrevious",
    "next": "/player/playback/skipNext",
    "seek": "/player/playback/seekTo",
    "volume": "/player/playback/setParameters",
}


def _child_attributes(element: ET.Element, name: str) -> dict:
    child = element.find(name)
    return dict(child.attrib) if child is not None else {}


def _integer(value, default=0) -> int:
    try:
        return int(float(value or default))
    except (TypeError, ValueError):
        return default


def _bool(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def _private_address(host: str) -> bool:
    """Only allow direct Companion commands to local/private player addresses."""
    value = (host or "").strip().strip("[]")
    if not value:
        return False
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        # Do not resolve hostnames here: resolving once for validation and again
        # in the HTTP client would leave a DNS-rebinding gap.
        return False
    if address.is_loopback or address.is_link_local:
        return True
    if address.version == 4:
        return any(
            address in network
            for network in (
                ipaddress.ip_network("10.0.0.0/8"),
                ipaddress.ip_network("172.16.0.0/12"),
                ipaddress.ip_network("192.168.0.0/16"),
            )
        )
    return address in ipaddress.ip_network("fc00::/7")


class PlexCompanion:
    def __init__(self, plex_client=plex):
        self.plex = plex_client
        self._command_lock = threading.Lock()
        self._last_command = int(time.time() * 1000)

    @staticmethod
    def controller_identifier() -> str:
        identifier = str(get_kv("plex_companion_controller_id", "") or "").strip()
        if identifier:
            return identifier
        identifier = f"songlib-amp-{uuid.uuid4().hex}"
        set_kv("plex_companion_controller_id", identifier)
        return identifier

    def _command_id(self) -> int:
        with self._command_lock:
            self._last_command += 1
            return self._last_command

    def clients(self) -> list[dict]:
        root = self.plex.xml("/clients")
        result = []
        for item in root:
            data = dict(item.attrib)
            identifier = str(
                data.get("machineIdentifier")
                or data.get("clientIdentifier")
                or data.get("uuid")
                or ""
            ).strip()
            if not identifier:
                continue
            capabilities = {
                value.strip().lower()
                for value in str(data.get("protocolCapabilities") or "").split(",")
                if value.strip()
            }
            host = str(data.get("host") or data.get("address") or "").strip()
            port = _integer(data.get("port"), 0)
            protocol = str(data.get("protocol") or "http").lower()
            if protocol not in {"http", "https"}:
                protocol = "http"
            safe_address = bool(0 < port < 65536 and _private_address(host))
            result.append(
                {
                    "id": identifier,
                    "name": data.get("name") or data.get("title") or "Plex 播放器",
                    "product": data.get("product") or "Plex",
                    "platform": data.get("platform") or data.get("device") or "",
                    "deviceClass": data.get("deviceClass") or "",
                    "version": data.get("version") or "",
                    "protocol": protocol,
                    "capabilities": sorted(capabilities),
                    "controllable": safe_address and "playback" in capabilities,
                    "controlReason": (
                        ""
                        if safe_address and "playback" in capabilities
                        else "播放器未公布播放控制能力"
                        if "playback" not in capabilities
                        else "播放器不在可直接访问的本地网络"
                    ),
                    # Kept server-side only when returned by _clients_by_id.
                    "_host": host,
                    "_port": port,
                }
            )
        return result

    def _clients_by_id(self) -> dict[str, dict]:
        return {item["id"]: item for item in self.clients()}

    def sessions(self) -> dict:
        client_warning = ""
        try:
            clients = self._clients_by_id()
        except Exception:
            # Newer Plex clients may expose an active session without
            # registering a directly controllable Companion endpoint.
            clients = {}
            client_warning = "Plex 返回了活动会话，但没有提供可远程控制的播放器列表"
        root = self.plex.xml("/status/sessions")
        sessions = []
        for item in root:
            if item.tag.lower() != "track":
                continue
            data = dict(item.attrib)
            player = _child_attributes(item, "Player")
            session = _child_attributes(item, "Session")
            client_id = str(
                player.get("machineIdentifier")
                or player.get("clientIdentifier")
                or data.get("clientIdentifier")
                or ""
            ).strip()
            client = clients.get(client_id)
            state = str(player.get("state") or data.get("state") or "unknown").lower()
            rating_key = str(data.get("ratingKey") or "").strip()
            thumb = data.get("thumb") or data.get("parentThumb") or data.get("grandparentThumb") or ""
            sessions.append(
                {
                    "id": str(
                        session.get("id")
                        or data.get("sessionKey")
                        or f"{client_id}:{rating_key}"
                    ),
                    "clientId": client_id,
                    "deviceName": (
                        player.get("title")
                        or (client or {}).get("name")
                        or player.get("device")
                        or "Plex 播放器"
                    ),
                    "product": player.get("product") or (client or {}).get("product") or "Plex",
                    "platform": player.get("platform") or (client or {}).get("platform") or "",
                    "device": player.get("device") or (client or {}).get("deviceClass") or "",
                    "state": state,
                    "playing": state in {"playing", "buffering"},
                    "ratingKey": rating_key,
                    "title": data.get("title") or "未命名歌曲",
                    "artist": data.get("grandparentTitle") or data.get("originalTitle") or "未知歌手",
                    "album": data.get("parentTitle") or "",
                    "durationMs": _integer(data.get("duration")),
                    "positionMs": _integer(data.get("viewOffset")),
                    "volume": max(0, min(_integer(player.get("volume"), 100), 100)),
                    "coverUrl": (
                        "/api/plex/image?path=" + urllib.parse.quote(thumb, safe="")
                        if thumb
                        else ""
                    ),
                    "local": _bool(player.get("local")),
                    "secure": _bool(player.get("secure")),
                    "relayed": _bool(player.get("relayed")),
                    "controllable": bool(client and client.get("controllable")),
                    "controlReason": (
                        (client or {}).get("controlReason")
                        or ("" if client else "播放器未出现在 Plex /clients 设备列表中")
                    ),
                }
            )
        sessions.sort(key=lambda value: (not value["playing"], value["deviceName"].casefold()))
        public_clients = [
            {key: value for key, value in item.items() if not key.startswith("_")}
            for item in clients.values()
        ]
        return {
            "connected": True,
            "sessions": sessions,
            "clients": public_clients,
            "clientWarning": client_warning,
            "polledAt": int(time.time() * 1000),
        }

    def command(self, client_id: str, action: str, value: int | None = None) -> dict:
        if action not in PLAYBACK_COMMANDS:
            raise ValueError("不支持的远程播放操作")
        client = self._clients_by_id().get(str(client_id or ""))
        if not client:
            raise KeyError("Plex 播放器已离线或未公布远程控制地址")
        if not client.get("controllable"):
            raise PermissionError(client.get("controlReason") or "这个播放器只能跟随，不能远程控制")
        host = client.get("_host") or ""
        port = _integer(client.get("_port"), 0)
        if not _private_address(host) or not (0 < port < 65536):
            raise PermissionError("为避免向外部地址发送控制请求，只允许控制同网段 Plex 播放器")
        formatted_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
        base_url = f"{client.get('protocol') or 'http'}://{formatted_host}:{port}"
        params = {"type": "music", "commandID": self._command_id()}
        if action == "seek":
            params["offset"] = max(0, min(_integer(value), 24 * 60 * 60 * 1000))
        elif action == "volume":
            params["volume"] = max(0, min(_integer(value), 100))
        controller_id = self.controller_identifier()
        headers = {
            "X-Plex-Client-Identifier": controller_id,
            "X-Plex-Target-Client-Identifier": client["id"],
            "X-Plex-Product": "SongLib Amp",
            "X-Plex-Version": "1.0",
            "X-Plex-Device": "SongLib Amp Web",
            "X-Plex-Device-Name": "SongLib Amp",
            "X-Plex-Platform": "Web",
            "X-Plex-Provides": "controller",
            "X-Plex-Token": self.plex.token,
        }
        with httpx.Client(timeout=4, follow_redirects=False) as client_http:
            response = client_http.get(
                base_url + PLAYBACK_COMMANDS[action],
                params=params,
                headers=headers,
            )
            response.raise_for_status()
        return {"ok": True, "clientId": client["id"], "action": action}


plex_companion = PlexCompanion()
