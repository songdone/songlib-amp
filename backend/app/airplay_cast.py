from __future__ import annotations

import io
import math
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .config import settings


_LINE_TIME = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]")
_WORD_TIME = re.compile(r"<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>")
_STREAM_FILE = re.compile(r"^(?:media\.m3u8|init\.mp4|segment_\d{9}\.m4s)$")


def _timestamp(minutes: str, seconds: str, fraction: str | None) -> float:
    digits = fraction or "0"
    fraction_seconds = int(digits) / (10 ** len(digits))
    return int(minutes) * 60 + int(seconds) + fraction_seconds


@dataclass(frozen=True)
class WordCue:
    time: float
    text: str


@dataclass(frozen=True)
class LyricLine:
    time: float
    text: str
    words: tuple[WordCue, ...] = ()


def parse_timed_lyrics(text: str) -> list[LyricLine]:
    """Parse regular LRC and enhanced LRC word timestamps.

    Enhanced LRC word markers are absolute timestamps such as
    ``[00:10.00]<00:10.00>逐<00:10.24>字``. Untimed metadata lines are
    ignored instead of being guessed into the playback clock.
    """
    result: list[LyricLine] = []
    for raw_line in str(text or "").replace("\\n", "\n").splitlines():
        line_times = list(_LINE_TIME.finditer(raw_line))
        if not line_times:
            continue
        body = raw_line[line_times[-1].end() :]
        word_marks = list(_WORD_TIME.finditer(body))
        words: list[WordCue] = []
        if word_marks:
            prefix = body[: word_marks[0].start()]
            for index, mark in enumerate(word_marks):
                end = word_marks[index + 1].start() if index + 1 < len(word_marks) else len(body)
                value = body[mark.end() : end]
                if index == 0 and prefix:
                    value = prefix + value
                if value:
                    words.append(WordCue(_timestamp(*mark.groups()), value))
            visible = "".join(word.text for word in words).strip() or "♪"
        else:
            visible = body.strip() or "♪"
        for mark in line_times:
            result.append(LyricLine(_timestamp(*mark.groups()), visible, tuple(words)))
    return sorted(result, key=lambda item: item.time)


@dataclass
class ClockDiscipline:
    gain: float
    max_step_seconds: float
    hard_sync_seconds: float
    anchor_position: float = 0.0
    anchor_monotonic: float = field(default_factory=time.monotonic)
    playing: bool = False
    last_error: float = 0.0

    def position(self, at: float | None = None) -> float:
        current = time.monotonic() if at is None else at
        elapsed = max(0.0, current - self.anchor_monotonic) if self.playing else 0.0
        return max(0.0, self.anchor_position + elapsed)

    def reset(self, observed: float, playing: bool, at: float | None = None) -> float:
        current = time.monotonic() if at is None else at
        self.anchor_position = max(0.0, float(observed or 0))
        self.anchor_monotonic = current
        self.playing = bool(playing)
        self.last_error = 0.0
        return self.anchor_position

    def update(self, observed: float, playing: bool, at: float | None = None) -> float:
        current = time.monotonic() if at is None else at
        predicted = self.position(current)
        observed = max(0.0, float(observed or 0))
        error = observed - predicted
        self.last_error = error
        if abs(error) >= self.hard_sync_seconds:
            corrected = observed
        else:
            correction = max(-self.max_step_seconds, min(self.max_step_seconds, error * self.gain))
            corrected = predicted + correction
        self.anchor_position = max(0.0, corrected)
        self.anchor_monotonic = current
        self.playing = bool(playing)
        return self.anchor_position


def qsv_available(ffmpeg_binary: str, dri_root: Path = Path("/dev/dri")) -> bool:
    if not dri_root.exists():
        return False
    try:
        result = subprocess.run(
            [ffmpeg_binary, "-hide_banner", "-encoders"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=5,
            check=False,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and "h264_qsv" in result.stdout


def _bitrate_bits(value: str) -> int:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*", str(value or ""))
    if not match:
        return 3_000_000
    amount = float(match.group(1))
    multiplier = {"": 1, "k": 1_000, "m": 1_000_000}[match.group(2).lower()]
    return max(1, int(amount * multiplier))


def build_master_playlist() -> str:
    video_bitrate = settings.airplay_video_bitrate or (
        "12M" if settings.airplay_width >= 3840 else "3M"
    )
    bandwidth = int((_bitrate_bits(video_bitrate) + 64_000) * 1.12)
    codec = "avc1.640033" if settings.airplay_width >= 3840 else "avc1.640029"
    return (
        "#EXTM3U\n"
        "#EXT-X-VERSION:7\n"
        "#EXT-X-INDEPENDENT-SEGMENTS\n"
        f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},'
        f'RESOLUTION={settings.airplay_width}x{settings.airplay_height},FRAME-RATE={settings.airplay_fps:.3f},'
        f'CODECS="{codec},mp4a.40.2"\n'
        "media.m3u8\n"
    )


def build_ffmpeg_command(output_dir: Path, *, use_qsv: bool) -> list[str]:
    width, height = settings.airplay_width, settings.airplay_height
    fps, segment = settings.airplay_fps, settings.airplay_segment_seconds
    bitrate = settings.airplay_video_bitrate or ("12M" if width >= 3840 else "3M")
    segment_text = f"{segment:g}"
    command = [
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
    ]
    render_node = Path("/dev/dri/renderD128")
    if use_qsv and render_node.exists():
        command += ["-qsv_device", str(render_node)]
    command += [
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        f"{width}x{height}",
        "-framerate",
        str(settings.airplay_render_fps),
        "-i",
        "pipe:0",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        f"fps={fps},format=nv12" if use_qsv else f"fps={fps},format=yuv420p",
    ]
    if use_qsv:
        command += [
            "-c:v",
            "h264_qsv",
            "-preset",
            "veryfast",
            "-profile:v",
            "high",
            "-level:v",
            "5.1" if width >= 3840 else "4.1",
            "-bf",
            "0",
        ]
    else:
        command += [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "high",
            "-level:v",
            "5.1" if width >= 3840 else "4.1",
            "-bf",
            "0",
            "-refs",
            "1",
        ]
    gop = max(1, round(fps * segment))
    command += [
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-b:v",
        bitrate,
        "-maxrate",
        bitrate,
        "-bufsize",
        bitrate,
        "-g",
        str(gop),
        "-keyint_min",
        str(gop),
        "-sc_threshold",
        "0",
        "-flags",
        "+cgop",
        "-force_key_frames",
        f"expr:gte(t,n_forced*{segment_text})",
        "-f",
        "hls",
        "-hls_time",
        segment_text,
        "-hls_list_size",
        "12",
        "-hls_delete_threshold",
        "6",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_flags",
        "delete_segments+independent_segments+program_date_time+temp_file",
        "-hls_segment_filename",
        str(output_dir / "segment_%09d.m4s"),
        str(output_dir / "media.m3u8"),
    ]
    return command


@lru_cache(maxsize=1)
def _font_path() -> str | None:
    candidates = [
        settings.airplay_font_path,
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/msyh.ttc",
    ]
    return next((item for item in candidates if item and Path(item).exists()), None)


@lru_cache(maxsize=32)
def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    regular = _font_path()
    bold_candidates = [
        settings.airplay_font_path,
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/msyhbd.ttc",
    ]
    selected = next((item for item in bold_candidates if bold and item and Path(item).exists()), regular)
    try:
        return ImageFont.truetype(selected, size=size) if selected else ImageFont.load_default(size=size)
    except (OSError, TypeError):
        return ImageFont.load_default()


def _fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    ratio = max(target_w / image.width, target_h / image.height)
    scaled = image.resize((max(1, int(image.width * ratio)), max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)
    left = max(0, (scaled.width - target_w) // 2)
    top = max(0, (scaled.height - target_h) // 2)
    return scaled.crop((left, top, left + target_w, top + target_h))


def _ellipsize(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> str:
    value = str(text or "")
    if draw.textlength(value, font=font) <= width:
        return value
    while value and draw.textlength(value + "…", font=font) > width:
        value = value[:-1]
    return value + "…"


@dataclass
class CastSession:
    session_id: str
    access_token: str
    owner_id: str
    output_dir: Path
    public_base_url: str
    created_at: float = field(default_factory=time.time)
    last_access_at: float = field(default_factory=time.time)
    last_stream_access_at: float = field(default_factory=time.time)
    lock: threading.RLock = field(default_factory=threading.RLock)
    stop_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    process: subprocess.Popen | None = None
    error: str = ""
    encoder_mode: str = "pending"
    encoder_starts: int = 0
    track_revision: int = 0
    state: dict = field(default_factory=lambda: {
        "trackId": "",
        "title": "等待播放",
        "artist": "SongLib Amp",
        "album": "歌词投屏已就绪",
        "quality": "",
        "lyrics": "",
        "duration": 0.0,
        "playing": False,
        "coverKey": "",
        "lyricsOffsetMs": 0,
        "transportLatencyMs": 0,
    })
    lyrics: list[LyricLine] = field(default_factory=list)
    clock: ClockDiscipline = field(default_factory=lambda: ClockDiscipline(
        gain=settings.airplay_drift_gain,
        max_step_seconds=settings.airplay_drift_step_ms / 1000,
        hard_sync_seconds=settings.airplay_hard_sync_ms / 1000,
    ))
    cover: Image.Image | None = None
    visual_base: Image.Image | None = None

    @property
    def stream_url(self) -> str:
        return f"{self.public_base_url}/api/airplay/stream/{self.access_token}/master.m3u8"


class AirPlayCastManager:
    def __init__(self, root: Path | None = None):
        self.root = root or settings.data_dir / "airplay-cast"
        self.root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, CastSession] = {}
        self._tokens: dict[str, str] = {}
        self._owners: dict[str, str] = {}
        self._lock = threading.RLock()

    def create(self, owner_id: str, public_base_url: str) -> CastSession:
        if not settings.airplay_cast_enabled:
            raise RuntimeError("服务器未启用 AirPlay 歌词投屏")
        self.cleanup_expired()
        with self._lock:
            existing_id = self._owners.get(owner_id)
            existing = self._sessions.get(existing_id or "")
            if existing and not existing.stop_event.is_set():
                existing.last_access_at = time.time()
                return existing
            session_id = uuid.uuid4().hex
            token = secrets.token_urlsafe(32)
            output_dir = self.root / session_id
            output_dir.mkdir(parents=True, exist_ok=False)
            session = CastSession(session_id, token, owner_id, output_dir, public_base_url.rstrip("/"))
            self._sessions[session_id] = session
            self._tokens[token] = session_id
            self._owners[owner_id] = session_id
            return session

    def _owned(self, session_id: str, owner_id: str) -> CastSession:
        with self._lock:
            session = self._sessions.get(session_id)
        if not session or session.owner_id != owner_id or session.stop_event.is_set():
            raise KeyError("投屏会话不存在或已结束")
        session.last_access_at = time.time()
        return session

    def track_changed(self, session_id: str, owner_id: str, track_id: str) -> bool:
        session = self._owned(session_id, owner_id)
        with session.lock:
            return str(session.state.get("trackId") or "") != str(track_id or "")

    def visual_changed(
        self,
        session_id: str,
        owner_id: str,
        track_id: str,
        cover_key: str = "",
    ) -> bool:
        session = self._owned(session_id, owner_id)
        with session.lock:
            return (
                str(session.state.get("trackId") or "") != str(track_id or "")
                or str(session.state.get("coverKey") or "") != str(cover_key or "")
            )

    def update(self, session_id: str, owner_id: str, payload: dict, cover_bytes: bytes | None = None) -> dict:
        session = self._owned(session_id, owner_id)
        track_id = str(payload.get("trackId") or "")[:300]
        with session.lock:
            changed = track_id != str(session.state.get("trackId") or "")
            cover_key = str(payload.get("coverKey") or "")[:2000]
            cover_changed = cover_key != str(session.state.get("coverKey") or "")
            if changed:
                session.track_revision += 1
                session.clock.reset(payload.get("position", 0), bool(payload.get("playing")))
            else:
                session.clock.update(payload.get("position", 0), bool(payload.get("playing")))
            next_state = {
                "trackId": track_id,
                "title": str(payload.get("title") or "未命名歌曲")[:200],
                "artist": str(payload.get("artist") or "未知歌手")[:200],
                "album": str(payload.get("album") or "未知专辑")[:200],
                "quality": str(payload.get("quality") or "")[:40],
                "lyrics": str(payload.get("lyrics") or "")[:300_000],
                "duration": max(0.0, float(payload.get("duration") or 0)),
                "playing": bool(payload.get("playing")),
                "coverKey": cover_key,
                "lyricsOffsetMs": max(-5000, min(5000, int(payload.get("lyricsOffsetMs") or 0))),
                "transportLatencyMs": max(
                    0,
                    min(5000, int(payload.get("transportLatencyMs") or 0)),
                ),
            }
            lyrics_changed = next_state["lyrics"] != session.state.get("lyrics")
            metadata_changed = any(next_state[key] != session.state.get(key) for key in ("trackId", "title", "artist", "album", "quality"))
            session.state = next_state
            if changed or cover_changed:
                session.cover = self._decode_cover(cover_bytes)
            if lyrics_changed:
                session.lyrics = parse_timed_lyrics(next_state["lyrics"])
            if metadata_changed or changed or cover_changed:
                session.visual_base = None
            session.error = "" if session.process and session.process.poll() is None else session.error
        return self.status(session_id, owner_id)

    def update_clock(self, session_id: str, owner_id: str, payload: dict) -> dict:
        """Apply the one-second transport heartbeat without resending lyrics.

        Lyrics can be hundreds of kilobytes. Keeping clock discipline on a
        small endpoint avoids repeatedly parsing and comparing that text while
        an iPad is also rendering the controller UI.
        """
        session = self._owned(session_id, owner_id)
        with session.lock:
            session.clock.update(
                payload.get("position", 0),
                bool(payload.get("playing")),
            )
            session.state["duration"] = max(
                0.0,
                float(payload.get("duration") or session.state.get("duration") or 0),
            )
            session.state["playing"] = bool(payload.get("playing"))
            session.state["lyricsOffsetMs"] = max(
                -5000,
                min(5000, int(payload.get("lyricsOffsetMs") or 0)),
            )
            session.state["transportLatencyMs"] = max(
                0,
                min(5000, int(payload.get("transportLatencyMs") or 0)),
            )
        return self.status(session_id, owner_id)

    @staticmethod
    def _decode_cover(data: bytes | None) -> Image.Image | None:
        if not data:
            return None
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
            return image.convert("RGB")
        except (OSError, ValueError):
            return None

    def status(self, session_id: str, owner_id: str) -> dict:
        session = self._owned(session_id, owner_id)
        with session.lock:
            running = bool(session.process and session.process.poll() is None)
            return {
                "sessionId": session.session_id,
                "streamUrl": session.stream_url,
                "status": "error" if session.error else "streaming" if running else "ready",
                "error": session.error,
                "encoder": session.encoder_mode,
                "encoderStarts": session.encoder_starts,
                "trackRevision": session.track_revision,
                "trackId": session.state.get("trackId") or "",
                "clockErrorMs": round(session.clock.last_error * 1000),
                "audioMode": "dual-clock-silent-aac",
                "lyricsOffsetMs": int(session.state.get("lyricsOffsetMs") or 0),
                "transportLatencyMs": int(session.state.get("transportLatencyMs") or 0)
                or settings.airplay_pipeline_advance_ms,
                "remoteControlMode": "continuous-hls-media-session",
                "video": {
                    "width": settings.airplay_width,
                    "height": settings.airplay_height,
                    "fps": settings.airplay_fps,
                    "segmentSeconds": settings.airplay_segment_seconds,
                },
            }

    def session_for_token(self, token: str) -> CastSession:
        with self._lock:
            session = self._sessions.get(self._tokens.get(token, ""))
        if not session or session.stop_event.is_set():
            raise KeyError("投屏地址无效或已过期")
        if time.time() - session.last_access_at > settings.airplay_session_ttl_seconds:
            self.stop(session.session_id, session.owner_id)
            raise KeyError("投屏地址已过期")
        session.last_access_at = time.time()
        session.last_stream_access_at = session.last_access_at
        return session

    def ensure_started(self, token: str) -> CastSession:
        session = self.session_for_token(token)
        with session.lock:
            if session.thread and session.thread.is_alive():
                return session
            if session.encoder_starts:
                self._clear_stream_files(session.output_dir)
            session.thread = threading.Thread(
                target=self._encoder_worker,
                args=(session,),
                name=f"airplay-cast-{session.session_id[:8]}",
                daemon=True,
            )
            session.thread.start()
        return session

    def wait_for_playlist(self, session: CastSession, timeout: float = 8.0) -> Path:
        target = session.output_dir / "media.m3u8"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if target.exists() and target.stat().st_size:
                return target
            if session.error:
                raise RuntimeError(session.error)
            time.sleep(0.05)
        raise RuntimeError("歌词视频流启动超时，请检查 FFmpeg 与编码器配置")

    def stream_file(self, token: str, filename: str) -> Path:
        if not _STREAM_FILE.fullmatch(filename):
            raise KeyError("非法分片名称")
        session = self.ensure_started(token)
        target = session.output_dir / filename
        if filename == "media.m3u8":
            return self.wait_for_playlist(session)
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            if target.exists() and target.is_file():
                return target
            if session.error:
                break
            time.sleep(0.04)
        raise KeyError("投屏分片不存在或已滑出实时窗口")

    def master_playlist(self, token: str) -> str:
        self.ensure_started(token)
        return build_master_playlist()

    def _encoder_worker(self, session: CastSession) -> None:
        wants_qsv = settings.airplay_encoder in {"auto", "qsv"}
        use_qsv = wants_qsv and qsv_available(settings.ffmpeg_binary)
        modes = [True, False] if use_qsv else [False]
        for index, qsv in enumerate(modes):
            if session.stop_event.is_set():
                return
            if index:
                self._clear_stream_files(session.output_dir)
            if self._run_encoder(session, use_qsv=qsv):
                return
        if not session.stop_event.is_set() and not session.error:
            session.error = "FFmpeg 歌词视频编码器意外退出"

    def _run_encoder(self, session: CastSession, *, use_qsv: bool) -> bool:
        command = build_ffmpeg_command(session.output_dir, use_qsv=use_qsv)
        log_path = session.output_dir / "ffmpeg.log"
        try:
            log_file = log_path.open("ab")
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=log_file,
                bufsize=0,
                cwd=session.output_dir,
            )
        except OSError as exc:
            session.error = f"无法启动 FFmpeg：{exc}"
            return False
        with session.lock:
            session.process = process
            session.encoder_mode = "qsv" if use_qsv else "software"
            session.encoder_starts += 1
            session.error = ""
        frame_interval = 1 / settings.airplay_render_fps
        next_frame = time.monotonic()
        wrote_frames = 0
        idle = False
        try:
            while not session.stop_event.is_set() and process.poll() is None:
                if time.time() - session.last_stream_access_at > settings.airplay_stream_idle_seconds:
                    idle = True
                    break
                frame = self._render_frame(session)
                if process.stdin is None:
                    break
                process.stdin.write(frame.tobytes())
                wrote_frames += 1
                next_frame += frame_interval
                delay = next_frame - time.monotonic()
                if delay > 0:
                    session.stop_event.wait(delay)
                elif delay < -frame_interval * 3:
                    next_frame = time.monotonic()
        except (BrokenPipeError, OSError):
            pass
        finally:
            if process.stdin:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
            log_file.close()
            with session.lock:
                if session.process is process:
                    session.process = None
        if session.stop_event.is_set() or idle:
            return True
        if use_qsv and wrote_frames < settings.airplay_render_fps * 5:
            return False
        tail = ""
        try:
            tail = log_path.read_text(encoding="utf-8", errors="ignore")[-800:].strip()
        except OSError:
            pass
        session.error = f"FFmpeg 歌词视频编码器退出{('：' + tail) if tail else ''}"
        return False

    @staticmethod
    def _clear_stream_files(output_dir: Path) -> None:
        for candidate in output_dir.iterdir():
            if candidate.name == "ffmpeg.log":
                continue
            if candidate.is_file() and (candidate.suffix in {".m3u8", ".mp4", ".m4s", ".tmp"} or ".m4s." in candidate.name):
                candidate.unlink(missing_ok=True)

    def _render_frame(self, session: CastSession) -> Image.Image:
        with session.lock:
            if session.visual_base is None:
                session.visual_base = self._build_visual_base(session)
            image = session.visual_base.copy()
            state = dict(session.state)
            lines = list(session.lyrics)
            media_time = session.clock.position()
            duration = float(state.get("duration") or 0)
        transport_latency_ms = int(state.get("transportLatencyMs") or 0)
        if not transport_latency_ms:
            transport_latency_ms = settings.airplay_pipeline_advance_ms
        display_time = media_time + transport_latency_ms / 1000
        image = self._animated_ambient(image, display_time)
        draw = ImageDraw.Draw(image, "RGBA")
        width, height = image.size
        lyric_time = display_time + (
            settings.airplay_lyric_advance_ms
            + int(state.get("lyricsOffsetMs") or 0)
        ) / 1000
        active = -1
        for index, line in enumerate(lines):
            if line.time <= lyric_time:
                active = index
            else:
                break
        if lines:
            indexes = [active - 2, active - 1, active, active + 1, active + 2]
            y_positions = [
                int(height * 0.20),
                int(height * 0.35),
                int(height * 0.50),
                int(height * 0.65),
                int(height * 0.79),
            ]
            for row, (index, y) in enumerate(zip(indexes, y_positions)):
                if not 0 <= index < len(lines):
                    continue
                line = lines[index]
                is_active = row == 2
                font = _font(max(28, int(height * (0.054 if is_active else 0.038))), bold=is_active)
                max_width = int(width * 0.50)
                text = _ellipsize(draw, line.text, font, max_width)
                x = int(width * 0.435)
                distance = abs(row - 2)
                fill = (255, 255, 255, 64 if distance == 2 else 118)
                if is_active and line.words:
                    cursor = x
                    for word in line.words:
                        segment = word.text
                        word_fill = (255, 255, 255, 255) if word.time <= lyric_time else (255, 255, 255, 145)
                        draw.text((cursor, y), segment, font=font, fill=word_fill, stroke_width=1, stroke_fill=(0, 0, 0, 110))
                        cursor += draw.textlength(segment, font=font)
                else:
                    draw.text((x, y), text, font=font, fill=(255, 255, 255, 245) if is_active else fill, stroke_width=1, stroke_fill=(0, 0, 0, 100))
        else:
            draw.text((int(width * 0.435), int(height * 0.50)), "歌词准备中", font=_font(int(height * 0.046), bold=True), fill=(255, 255, 255, 150))

        left, right = int(width * 0.435), int(width * 0.93)
        bar_y = int(height * 0.91)
        draw.rounded_rectangle((left, bar_y, right, bar_y + max(5, height // 180)), radius=8, fill=(255, 255, 255, 42))
        ratio = min(1.0, display_time / duration) if duration else 0.0
        draw.rounded_rectangle((left, bar_y, left + int((right - left) * ratio), bar_y + max(5, height // 180)), radius=8, fill=(255, 255, 255, 230))
        small = _font(max(18, height // 48))
        draw.text((left, bar_y + 18), self._format_time(display_time), font=small, fill=(255, 255, 255, 145))
        remaining = self._format_time(duration)
        draw.text((right - draw.textlength(remaining, font=small), bar_y + 18), remaining, font=small, fill=(255, 255, 255, 145))
        if not state.get("playing"):
            draw.rounded_rectangle((width - 175, 42, width - 52, 90), radius=24, fill=(0, 0, 0, 110), outline=(255, 255, 255, 32))
            draw.text((width - 143, 52), "已暂停", font=_font(22, bold=True), fill=(255, 255, 255, 185))
        return image

    @staticmethod
    def _animated_ambient(image: Image.Image, media_time: float) -> Image.Image:
        width, height = image.size
        scale = 8
        small_w, small_h = max(80, width // scale), max(45, height // scale)
        overlay = Image.new("RGBA", (small_w, small_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay, "RGBA")
        phase = media_time / 16
        first_x = int(small_w * (0.62 + math.sin(phase) * 0.10))
        first_y = int(small_h * (0.34 + math.cos(phase * 0.73) * 0.12))
        second_x = int(small_w * (0.76 + math.cos(phase * 0.61) * 0.08))
        second_y = int(small_h * (0.68 + math.sin(phase * 0.83) * 0.10))
        radius = max(small_w // 5, small_h // 3)
        draw.ellipse((first_x - radius, first_y - radius, first_x + radius, first_y + radius), fill=(238, 173, 67, 30))
        draw.ellipse((second_x - radius, second_y - radius, second_x + radius, second_y + radius), fill=(121, 86, 207, 24))
        overlay = overlay.filter(ImageFilter.GaussianBlur(max(8, radius // 2)))
        overlay = overlay.resize((width, height), Image.Resampling.BILINEAR)
        return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")

    @staticmethod
    def _format_time(value: float) -> str:
        seconds = max(0, int(value or 0))
        return f"{seconds // 60}:{seconds % 60:02d}"

    def _build_visual_base(self, session: CastSession) -> Image.Image:
        width, height = settings.airplay_width, settings.airplay_height
        if session.cover:
            background = _fit_cover(session.cover, (width, height)).filter(ImageFilter.GaussianBlur(max(24, width // 35)))
            background = Image.blend(background, Image.new("RGB", (width, height), "#08090d"), 0.58)
            sample = session.cover.resize((1, 1), Image.Resampling.BILINEAR).getpixel((0, 0))
        else:
            background = Image.new("RGB", (width, height), "#08090d")
            sample = (221, 164, 69)
        glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow, "RGBA")
        glow_draw.ellipse((-width // 5, -height // 3, width // 2, height * 4 // 3), fill=(*sample, 72))
        glow_draw.ellipse((width // 2, height // 3, width * 6 // 5, height * 4 // 3), fill=(116, 79, 190, 42))
        glow = glow.filter(ImageFilter.GaussianBlur(max(50, width // 16)))
        image = Image.alpha_composite(background.convert("RGBA"), glow)
        shade = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        shade_draw = ImageDraw.Draw(shade, "RGBA")
        shade_draw.rectangle((0, 0, int(width * 0.36), height), fill=(0, 0, 0, 72))
        shade_draw.rectangle((int(width * 0.34), 0, width, height), fill=(4, 5, 9, 42))
        image = Image.alpha_composite(image, shade)
        draw = ImageDraw.Draw(image, "RGBA")
        cover_size = int(min(width * 0.255, height * 0.46))
        cover_x, cover_y = int(width * 0.072), int(height * 0.175)
        radius = width // 70
        draw.rounded_rectangle((cover_x - 22, cover_y + 18, cover_x + cover_size + 22, cover_y + cover_size + 36), radius=radius + 5, fill=(0, 0, 0, 96), outline=(255, 255, 255, 32), width=2)
        draw.rounded_rectangle((cover_x - 7, cover_y - 7, cover_x + cover_size + 7, cover_y + cover_size + 7), radius=radius, fill=(0, 0, 0, 92), outline=(255, 255, 255, 28), width=2)
        if session.cover:
            cover = _fit_cover(session.cover, (cover_size, cover_size))
            mask = Image.new("L", (cover_size, cover_size), 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, cover_size, cover_size), radius=width // 80, fill=255)
            image.paste(cover, (cover_x, cover_y), mask)
        else:
            draw.rounded_rectangle((cover_x, cover_y, cover_x + cover_size, cover_y + cover_size), radius=width // 80, fill=(255, 255, 255, 20))
            draw.text((cover_x + cover_size * 0.38, cover_y + cover_size * 0.36), "♪", font=_font(cover_size // 4, bold=True), fill=(255, 204, 98, 210))
        state = session.state
        label = _font(max(18, height // 50), bold=True)
        title_font = _font(max(30, height // 27), bold=True)
        meta_font = _font(max(20, height // 39))
        info_width = int(width * 0.34)
        info_center = cover_x + cover_size // 2
        title = _ellipsize(draw, state.get("title") or "等待播放", title_font, info_width)
        title_x = info_center - int(draw.textlength(title, font=title_font) / 2)
        title_y = cover_y + cover_size + int(height * 0.09)
        draw.text((title_x, title_y), title, font=title_font, fill=(255, 255, 255, 245), stroke_width=1, stroke_fill=(0, 0, 0, 100))
        meta = f"{state.get('artist') or '未知歌手'}  ·  {state.get('album') or '未知专辑'}"
        meta = _ellipsize(draw, meta, meta_font, info_width)
        meta_x = info_center - int(draw.textlength(meta, font=meta_font) / 2)
        draw.text((meta_x, title_y + int(height * 0.057)), meta, font=meta_font, fill=(255, 255, 255, 145))
        quality = state.get("quality") or "LYRICS CAST"
        quality_text = quality.upper()
        quality_x = info_center - int(draw.textlength(quality_text, font=label) / 2)
        draw.text((quality_x, title_y + int(height * 0.112)), quality_text, font=label, fill=(255, 255, 255, 105))
        return image.convert("RGB")

    def stop(self, session_id: str, owner_id: str) -> None:
        session = self._owned(session_id, owner_id)
        session.stop_event.set()
        process = session.process
        if process and process.poll() is None:
            process.terminate()
        thread = session.thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=4)
        with self._lock:
            self._sessions.pop(session.session_id, None)
            self._tokens.pop(session.access_token, None)
            if self._owners.get(owner_id) == session.session_id:
                self._owners.pop(owner_id, None)
        shutil.rmtree(session.output_dir, ignore_errors=True)

    def cleanup_expired(self) -> None:
        with self._lock:
            expired = [
                (session.session_id, session.owner_id)
                for session in self._sessions.values()
                if time.time() - session.last_access_at > settings.airplay_session_ttl_seconds
            ]
        for session_id, owner_id in expired:
            try:
                self.stop(session_id, owner_id)
            except KeyError:
                pass

    def shutdown(self) -> None:
        with self._lock:
            sessions = [(item.session_id, item.owner_id) for item in self._sessions.values()]
        for session_id, owner_id in sessions:
            try:
                self.stop(session_id, owner_id)
            except KeyError:
                pass


cast_manager = AirPlayCastManager()
