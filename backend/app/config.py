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


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise RuntimeError(f"{name} 必须是数字") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} 必须在 {minimum} 到 {maximum} 之间")
    return value


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "SongLib Amp｜音屿")
    app_version: str = os.getenv("APP_VERSION", "1.5.2")
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
    download_dir: str = os.getenv("DOWNLOAD_DIR", "authorized")
    download_mount: Path = Path(os.getenv("DOWNLOAD_ROOT", "/downloads"))
    max_download_mb: int = _int_env("MAX_DOWNLOAD_MB", 500, 1, 10_000)
    source_max_size_mb: int = _int_env("SOURCE_MAX_SIZE_MB", 2, 1, 50)
    source_timeout_seconds: int = _int_env("SOURCE_TIMEOUT_SECONDS", 55, 5, 600)
    allow_private_download_urls: bool = _bool_env("ALLOW_PRIVATE_DOWNLOAD_URLS", False)
    allow_proxy_fake_ips: bool = _bool_env("ALLOW_PROXY_FAKE_IPS", False)
    fnos_music_url: str = os.getenv("FNOS_MUSIC_URL", "").strip().rstrip("/")
    fnos_music_token: str = os.getenv("FNOS_MUSIC_TOKEN", "").strip()
    airplay_cast_enabled: bool = _bool_env("AIRPLAY_CAST_ENABLED", True)
    airplay_public_base_url: str = os.getenv("AIRPLAY_PUBLIC_BASE_URL", "").strip().rstrip("/")
    airplay_width: int = _int_env("AIRPLAY_WIDTH", 1920, 640, 3840)
    airplay_height: int = _int_env("AIRPLAY_HEIGHT", 1080, 360, 2160)
    airplay_fps: int = _int_env("AIRPLAY_FPS", 30, 24, 30)
    airplay_render_fps: int = _int_env("AIRPLAY_RENDER_FPS", 4, 2, 15)
    # FFmpeg rounds EXT-X-TARGETDURATION to an integer. Values below one
    # second therefore produce TARGETDURATION:0, which Apple HLS clients reject.
    airplay_segment_seconds: float = _float_env("AIRPLAY_SEGMENT_SECONDS", 1.0, 1.0, 3.0)
    airplay_encoder: str = os.getenv("AIRPLAY_ENCODER", "auto").strip().lower()
    airplay_video_bitrate: str = os.getenv("AIRPLAY_VIDEO_BITRATE", "").strip()
    airplay_lyric_advance_ms: int = _int_env("AIRPLAY_LYRIC_ADVANCE_MS", 250, -3000, 3000)
    airplay_pipeline_advance_ms: int = _int_env("AIRPLAY_PIPELINE_ADVANCE_MS", 1750, 0, 5000)
    airplay_drift_gain: float = _float_env("AIRPLAY_DRIFT_GAIN", 0.35, 0.05, 1.0)
    airplay_drift_step_ms: int = _int_env("AIRPLAY_DRIFT_STEP_MS", 250, 25, 2000)
    airplay_hard_sync_ms: int = _int_env("AIRPLAY_HARD_SYNC_MS", 2000, 250, 10000)
    airplay_session_ttl_seconds: int = _int_env("AIRPLAY_SESSION_TTL_SECONDS", 14400, 300, 86400)
    airplay_stream_idle_seconds: int = _int_env("AIRPLAY_STREAM_IDLE_SECONDS", 90, 30, 900)
    airplay_font_path: str = os.getenv("AIRPLAY_FONT_PATH", "").strip()
    ffmpeg_binary: str = os.getenv("FFMPEG_BINARY", "ffmpeg").strip() or "ffmpeg"

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.worker_mode not in {"embedded", "web", "worker"}:
            errors.append("WORKER_MODE 只能是 embedded、web 或 worker")
        for origin in self.trusted_origins:
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append(f"TRUSTED_ORIGINS 中的地址无效：{origin}")
        if self.fnos_music_url:
            parsed = urlparse(self.fnos_music_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                errors.append("FNOS_MUSIC_URL 必须是有效的 HTTP(S) 地址")
        if self.airplay_public_base_url:
            parsed = urlparse(self.airplay_public_base_url)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                errors.append("AIRPLAY_PUBLIC_BASE_URL 必须是没有路径的 HTTP(S) 站点地址")
        if self.airplay_encoder not in {"auto", "qsv", "software"}:
            errors.append("AIRPLAY_ENCODER 只能是 auto、qsv 或 software")
        if self.airplay_width * 9 != self.airplay_height * 16:
            errors.append("AIRPLAY_WIDTH 与 AIRPLAY_HEIGHT 必须保持 16:9")
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
        return self.download_mount / "_incoming"

    @property
    def download_root(self) -> Path:
        value = self.download_dir.strip()
        return self.download_mount if value in ("", ".", "/") else self.download_mount / value

    @property
    def trash_dir(self) -> Path:
        return self.music_root / ".trash"

    @property
    def manual_download_dir(self) -> Path:
        return self.download_mount

    @property
    def download_trash_dir(self) -> Path:
        return self.download_mount / ".trash"

    @property
    def preferences_path(self) -> Path:
        direct = self.plex_config / "Preferences.xml"
        nested = self.plex_config / "Library/Application Support/Plex Media Server/Preferences.xml"
        return direct if direct.exists() else nested

    @property
    def resolved_node_binary(self) -> str:
        return self.node_binary or shutil.which("node") or shutil.which("nodejs") or "node"


settings = Settings()
