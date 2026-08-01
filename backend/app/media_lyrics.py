from __future__ import annotations

from pathlib import Path

from mutagen import File as MutagenFile


LYRIC_SUFFIXES = {".lrc", ".txt"}


def _decode_lyrics(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16").strip()
    try:
        return data.decode("utf-8-sig").strip()
    except UnicodeDecodeError:
        pass

    candidates: list[str] = []
    for encoding in ("gb18030", "big5"):
        try:
            candidates.append(data.decode(encoding).strip())
        except UnicodeDecodeError:
            continue
    if candidates:
        def corruption_score(text: str) -> int:
            return sum(
                100
                for character in text
                if "\ue000" <= character <= "\uf8ff"
                or character == "\ufffd"
                or (ord(character) < 32 and character not in "\n\r\t")
            ) + sum(2 for character in text if "\u3400" <= character <= "\u4dbf")

        return min(candidates, key=corruption_score)
    return data.decode("utf-8", errors="ignore").strip()


def _sidecar_candidates(audio_path: Path) -> list[Path]:
    candidates = [
        audio_path.with_suffix(".lrc"),
        audio_path.with_suffix(".txt"),
    ]
    try:
        for candidate in audio_path.parent.iterdir():
            if (
                candidate.is_file()
                and candidate.stem.casefold() == audio_path.stem.casefold()
                and candidate.suffix.casefold() in LYRIC_SUFFIXES
                and candidate not in candidates
            ):
                candidates.append(candidate)
    except OSError:
        pass
    return candidates


def _embedded_lyrics(audio_path: Path) -> str:
    try:
        audio = MutagenFile(audio_path, easy=False)
    except Exception:
        return ""
    tags = getattr(audio, "tags", {}) if audio else {}
    if not tags:
        return ""
    for key, value in tags.items():
        normalized = str(key).casefold()
        if not (
            normalized.startswith("uslt")
            or normalized in {"lyrics", "\xa9lyr", "unsyncedlyrics"}
        ):
            continue
        item = value[0] if isinstance(value, (list, tuple)) and value else value
        text = getattr(item, "text", item)
        if isinstance(text, (list, tuple)):
            text = "\n".join(str(part) for part in text)
        resolved = str(text or "").strip()
        if resolved:
            return resolved
    return ""


def read_local_lyrics(audio_path: Path) -> dict[str, str]:
    for candidate in _sidecar_candidates(audio_path):
        if not candidate.exists():
            continue
        try:
            lyrics = _decode_lyrics(candidate.read_bytes())
        except OSError:
            continue
        if lyrics:
            return {
                "lyrics": lyrics,
                "format": candidate.suffix.casefold().lstrip("."),
                "source": "sidecar",
            }
    embedded = _embedded_lyrics(audio_path)
    if embedded:
        return {
            "lyrics": embedded,
            "format": "text",
            "source": "embedded",
        }
    return {"lyrics": "", "format": "none", "source": ""}
