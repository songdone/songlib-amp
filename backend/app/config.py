from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "SongLib Amp｜音屿")
    app_version: str = "0.8.0"
    data_dir: Path = Path(os.getenv("DATA_DIR", "/data"))
    music_root: Path = Path(os.getenv("MUSIC_ROOT", "/music"))
    plex_config: Path = Path(os.getenv("PLEX_CONFIG", "/plex-config"))
    plex_url: str = os.getenv("PLEX_URL", "http://127.0.0.1:32400").rstrip("/")
    plex_section: str = os.getenv("PLEX_SECTION", "26")
    plex_media_prefix: str = os.getenv("PLEX_MEDIA_PREFIX", "/media/音乐/")
    app_password: str = os.getenv("APP_PASSWORD", "")
    session_secret: str = os.getenv("SESSION_SECRET", "")
    download_dir: str = os.getenv("DOWNLOAD_DIR", "_downloads")
    download_mount: Path = Path(os.getenv("DOWNLOAD_ROOT", "/downloads"))
    max_download_mb: int = int(os.getenv("MAX_DOWNLOAD_MB", "500"))
    source_max_size_mb: int = int(os.getenv("SOURCE_MAX_SIZE_MB", "2"))
    source_timeout_seconds: int = int(os.getenv("SOURCE_TIMEOUT_SECONDS", "55"))
    allow_private_download_urls: bool = os.getenv("ALLOW_PRIVATE_DOWNLOAD_URLS", "false").lower() == "true"
    allow_proxy_fake_ips: bool = os.getenv("ALLOW_PROXY_FAKE_IPS", "false").lower() == "true"

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


settings = Settings()
