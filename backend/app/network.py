from __future__ import annotations

import ipaddress
import socket
import urllib.parse

from .config import settings


def validate_public_url(url: str, *, label: str = "地址") -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"{label}必须是有效的 HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{label}不能包含用户名或密码")
    if settings.allow_private_download_urls:
        return
    hostname = parsed.hostname.casefold()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError(f"{label}指向本机地址，已被安全策略拦截")
    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise ValueError(f"{label}的域名无法解析") from exc
    for entry in addresses:
        address = ipaddress.ip_address(entry[4][0].split("%", 1)[0])
        fake_proxy_ip = address.version == 4 and address in ipaddress.ip_network("198.18.0.0/15")
        if fake_proxy_ip and settings.allow_proxy_fake_ips and not _is_ip_literal(hostname):
            continue
        if (
            address.is_private or address.is_loopback or address.is_link_local
            or address.is_reserved or address.is_multicast or address.is_unspecified
        ):
            raise ValueError(f"{label}指向内网或保留地址，已被安全策略拦截")


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname.strip("[]"))
        return True
    except ValueError:
        return False
