"""请求体模型。

原先这 37 个模型和 129 个路由挤在 main.py 里。它们是纯数据契约，
和协议处理、领域逻辑都无关，单独放一处便于查阅接口输入约束。

命名沿用 `<用途>Body`，与路由函数签名一一对应。
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, HttpUrl


class LoginBody(BaseModel):
    username: str = "admin"
    password: str


class SetupBody(BaseModel):
    username: str = Field(default="admin", min_length=2, max_length=40)
    displayName: str = Field(default="", max_length=80)
    password: str = Field(min_length=12, max_length=200)


class PlaylistBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    items: list[dict] = Field(default_factory=list, max_length=20_000)


class PlaylistPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    items: list[dict] | None = Field(default=None, max_length=20_000)


class M3UImportBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(max_length=2_100_000)
    pathMappings: list[dict] = Field(default_factory=list, max_length=100)


class PlaylistSharePreviewBody(BaseModel):
    shareUrl: str = Field(min_length=10, max_length=2_000)


class PlaylistMigrationBody(BaseModel):
    sourceUrl: str = Field(min_length=10, max_length=2_000)
    targets: list[str] = Field(default_factory=lambda: ["songlib"], max_length=3)
    downloadMissing: bool = False
    sourceId: str | None = None
    quality: str = "320k"


class PlaylistSyncBody(BaseModel):
    targets: list[str] = Field(min_length=1, max_length=2)


class ListeningEventBody(BaseModel):
    eventType: str
    fileId: str | None = None
    externalRef: str | None = None
    positionMs: int = Field(default=0, ge=0)
    durationMs: int = Field(default=0, ge=0)
    context: dict = Field(default_factory=dict)


class RecommendationRefreshBody(BaseModel):
    exploration: float = Field(default=0.35, ge=0, le=1)
    discoveries: list[dict] = Field(default_factory=list, max_length=500)


class ChangePasswordBody(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=10, max_length=200)


class UserCreateBody(BaseModel):
    username: str
    displayName: str = ""
    password: str = Field(min_length=10, max_length=200)
    role: str = "listener"
    permissions: list[str] = Field(default_factory=lambda: ["listen"])
    libraryScopes: list[str] = Field(default_factory=list)


class UserUpdateBody(BaseModel):
    username: str | None = None
    displayName: str | None = None
    enabled: bool | None = None
    permissions: list[str] | None = None
    libraryScopes: list[str] | None = None


class UserPasswordBody(BaseModel):
    password: str = Field(min_length=10, max_length=200)


class SourceBody(BaseModel):
    name: str = ""
    url: HttpUrl


class SourceImportUrlBody(BaseModel):
    name: str = ""
    url: str


class SourceImportCodeBody(BaseModel):
    name: str = ""
    code: str


class SourceSearchBody(BaseModel):
    keyword: str = Field(min_length=1, max_length=100)
    platform: Optional[str] = None


class SourceResolveBody(BaseModel):
    track: dict
    quality: str = "320k"


class JobBody(BaseModel):
    kind: str
    payload: dict = Field(default_factory=dict)


class DownloadBody(BaseModel):
    sourceId: str
    quality: str
    item: dict


class BatchDownloadDecisionBody(BaseModel):
    jobIds: list[int] = Field(default_factory=list)


class SourcePreviewBody(BaseModel):
    sourceId: str
    quality: str = "128k"
    item: dict


class SettingsPatchBody(BaseModel):
    values: dict = Field(default_factory=dict)


class PlexSettingsBody(BaseModel):
    enabled: bool = True
    name: str = Field(default="Plex", min_length=1, max_length=80)
    serverUrl: str
    externalUrl: str = ""
    token: str = ""
    selectedLibraryKeys: list[str] | str = "all"


class PlexTestBody(BaseModel):
    serverUrl: str | None = None
    token: str | None = None


class PlexRemoteCommandBody(BaseModel):
    action: str = Field(pattern="^(play|pause|stop|previous|next|seek|volume)$")
    value: int | None = None


class FnosSettingsBody(BaseModel):
    serverUrl: str
    authMode: str = Field(default="password", pattern="^(password|token)$")
    username: str = Field(default="", max_length=120)
    password: str = Field(default="", max_length=300)
    token: str = Field(default="", max_length=2_000)


class TagUpdateBody(BaseModel):
    changes: dict


class TagFillPreviewBody(BaseModel):
    fileIds: list[str] = []


class PlaybackPositionBody(BaseModel):
    trackKey: str
    position: float = 0
    duration: float = 0
    title: str = ""
    artist: str = ""
    album: str = ""
    coverUrl: str = ""
    device: str = ""
    # 整条曲目快照。原文件之后被删掉时，"继续听"这条记录还能显示得出来。
    track: dict = {}


class RollbackBatchBody(BaseModel):
    # 一次整理可能有几百条。上限给到 2000，和入库那边保持一致。
    ids: list[str] = Field(min_length=1, max_length=2_000)


class OrganizePreviewBody(BaseModel):
    fileIds: list[str]


class OrganizeApplyBody(BaseModel):
    previews: list[dict]


class DownloadInboxApplyBody(BaseModel):
    items: list[dict] = Field(min_length=1, max_length=2_000)


class ScrapePreviewBody(BaseModel):
    kind: str
    scope: str = "missing"
    scopeValue: str = Field(default="", max_length=300)
    mode: str = "missing"
    limit: int = Field(default=100, ge=1, le=500)


class ScrapeApplyBody(BaseModel):
    planId: str


class DiscoveryDownloadBody(BaseModel):
    sourceId: str
    quality: str = "320k"
    tracks: list[dict] = Field(default_factory=list, max_length=100)


class AirPlayCastUpdateBody(BaseModel):
    trackId: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=200)
    artist: str = Field(default="", max_length=200)
    album: str = Field(default="", max_length=200)
    quality: str = Field(default="", max_length=40)
    lyrics: str = Field(default="", max_length=300_000)
    position: float = Field(default=0, ge=0, le=60 * 60 * 24)
    duration: float = Field(default=0, ge=0, le=60 * 60 * 24)
    playing: bool = False
    sourceType: str = Field(default="", max_length=40)
    localFileId: str = Field(default="", max_length=300)
    plexRatingKey: str = Field(default="", max_length=300)
    coverKey: str = Field(default="", max_length=2_000)
    lyricsOffsetMs: int = Field(default=0, ge=-5000, le=5000)
    transportLatencyMs: int = Field(default=0, ge=0, le=5000)


class AirPlayCastClockBody(BaseModel):
    position: float = Field(default=0, ge=0, le=60 * 60 * 24)
    duration: float = Field(default=0, ge=0, le=60 * 60 * 24)
    playing: bool = False
    lyricsOffsetMs: int = Field(default=0, ge=-5000, le=5000)
    transportLatencyMs: int = Field(default=0, ge=0, le=5000)
