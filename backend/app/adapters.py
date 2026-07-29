from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class TrackIdentity:
    title: str
    artist: str
    album: str = ""
    duration_ms: int = 0


@runtime_checkable
class MediaLibraryAdapter(Protocol):
    kind: str

    def health(self) -> dict: ...

    def scan(self) -> dict: ...

    def tracks(self, search: str = "") -> list[dict]: ...

    def playlists(self) -> list[dict]: ...


@runtime_checkable
class MetadataProviderAdapter(Protocol):
    kind: str

    def search(self, identity: TrackIdentity) -> list[dict]: ...

    def artwork(self, identity: TrackIdentity) -> list[dict]: ...

    def lyrics(self, identity: TrackIdentity) -> list[dict]: ...


@runtime_checkable
class AuthorizedDownloadAdapter(Protocol):
    kind: str

    def search(self, identity: TrackIdentity) -> list[dict]: ...

    def resolve(self, item: dict, quality: str) -> dict: ...


class AdapterRegistry:
    def __init__(self):
        self._adapters: dict[tuple[str, str], object] = {}

    def register(self, category: str, kind: str, adapter: object) -> None:
        self._adapters[(category, kind)] = adapter

    def get(self, category: str, kind: str):
        return self._adapters.get((category, kind))

    def list(self, category: str) -> list[dict]:
        return [
            {"category": item_category, "kind": kind, "available": True}
            for (item_category, kind), _adapter in sorted(self._adapters.items())
            if item_category == category
        ]


registry = AdapterRegistry()
