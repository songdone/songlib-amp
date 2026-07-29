from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


def _bool_env(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise RuntimeError(f"{name} 必须是整数") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} 必须在 {minimum} 到 {maximum} 之间")
    return value


def _csv_env(name: str) -> tuple[str, ...]:
    return tuple(value.strip().rstrip("/") for value in os.getenv(name, "").split(",") if value.strip())


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "SongLib Amp｜音屿")
    app_version: str = os.getenv("APP_VERSION", "1.0.0-rc.1")
    environment: str = os.getenv("APP_ENV", "production").strip().lower()
    data_dir: Path = Path(os.getenv("DATA_DIR", "/data"))
    music_root: Path = Path(os.getenv("MUSIC_ROOT", "/music"))
    plex_config: Path = Path(os.getenv("PLEX_CONFIG", "/plex-config"))
    plex_url: str = os.getenv("PLEX_URL", "").strip().rstrip("/")
    plex_section: str = os.getenv("PLEX_SECTION", "").strip()
    plex_media_prefix: str = os.getenv("PLEX_MEDIA_PREFIX", "").strip()
    app_password: str = os.getenv("APP_PASSWORD", "")
    session_secret: str = os.getenv("SESSION_SECRET", "")
    cookie_secure: bool = _bool_env("COOKIE_SECURE", False)
    trusted_origins: tuple[str, ...] = _csv_env("TRUSTED_ORIGINS")
    trusted_hosts: tuple[str, ...] = _csv_env("TRUSTED_HOSTS")
    worker_mode: str = os.getenv("WORKER_MODE", "embedded").strip().lower()
    worker_poll_seconds: int = _int_env("WORKER_POLL_SECONDS", 2, 1, 60)
    worker_lease_seconds: int = _int_env("WORKER_LEASE_SECONDS", 180, 30, 3600)
    worker_max_attempts: int = _int_env("WORKER_MAX_ATTEMPTS", 3, 1, 10)
    node_binary: str = os.getenv("NODE_BINARY", "").strip()
    download_dir: str = os.getenv("DOWNLOAD_DIR", "_downloads")
    download_mount: Path = Path(os.getenv("DOWNLOAD_ROOT", "/downloads"))
    max_download_mb: int = _int_env("MAX_DOWNLOAD_MB", 500, 1, 10_000)
    source_max_size_mb: int = _int_env("SOURCE_MAX_SIZE_MB", 2, 1, 50)
    source_timeout_seconds: int = _int_env("SOURCE_TIMEOUT_SECONDS", 55, 5, 600)
    allow_private_download_urls: bool = _bool_env("ALLOW_PRIVATE_DOWNLOAD_URLS", False)
    allow_proxy_fake_ips: bool = _bool_env("ALLOW_PROXY_FAKE_IPS", False)

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.worker_mode not in {"embedded", "web", "worker"}:
            errors.append("WORKER_MODE 只能是 embedded、web 或 worker")
        for origin in self.trusted_origins:
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append(f"TRUSTED_ORIGINS 中的地址无效：{origin}")
        if self.environment == "production" and self.session_secret and len(self.session_secret) < 32:
            errors.append("生产环境的 SESSION_SECRET 至少需要 32 个字符")
        return errors

    @property
    def db_path(self) -> Path:
        return self.data_dir / "manager.db"

    @property
    def source_dir(self) -> Path:
        return self.data_dir / "sources"

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def incoming_dir(self) -> Path:
        return self.music_root / "_incoming"

    @property
    def download_root(self) -> Path:
        value = self.download_dir.strip()
        return self.music_root if value in ("", ".", "/") else self.music_root / value

    @property
    def trash_dir(self) -> Path:
        return self.music_root / ".trash"

    @property
    def manual_download_dir(self) -> Path:
        return self.download_mount

    @property
    def preferences_path(self) -> Path:
        direct = self.plex_config / "Preferences.xml"
        nested = self.plex_config / "Library/Application Support/Plex Media Server/Preferences.xml"
        return direct if direct.exists() else nested

    @property
    def resolved_node_binary(self) -> str:
        return self.node_binary or shutil.which("node") or shutil.which("nodejs") or "node"


settings = Settings()
