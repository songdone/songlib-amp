from __future__ import annotations

import ipaddress
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
from urllib.parse import urlparse


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


def build_master_playlist(profile: dict | None = None) -> str:
    """主播放列表。

    FRAME-RATE 必须报**实际**的输出帧率。原来这里写死
    settings.airplay_fps（30），而公网档实际编的是 15fps ——
    播放列表宣称 30、流里是 15，客户端是按声明去准备解码的，
    这种不一致本身就够让它出问题。
    """
    video_bitrate = settings.airplay_video_bitrate or (
        "12M" if settings.airplay_width >= 3840 else "3M"
    )
    bandwidth = int((_bitrate_bits(video_bitrate) + 64_000) * 1.12)
    codec = "avc1.640033" if settings.airplay_width >= 3840 else "avc1.640029"
    fps = float((profile or stream_profile(False))["fps"])
    return (
        "#EXTM3U\n"
        "#EXT-X-VERSION:7\n"
        "#EXT-X-INDEPENDENT-SEGMENTS\n"
        f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},'
        f'RESOLUTION={settings.airplay_width}x{settings.airplay_height},FRAME-RATE={fps:.3f},'
        f'CODECS="{codec},mp4a.40.2"\n'
        "media.m3u8\n"
    )



def wan_profile(public_base_url: str) -> bool:
    """这条投屏地址要走公网吗？

    投屏的画面是 Apple TV 自己去拉的 HLS。局域网和公网对 HLS 的要求
    差得很远，用同一套参数必然有一边是坏的：

    - 局域网：RTT 一两毫秒、带宽足，1 秒分片能做到很低的延迟。
    - 公网：RTT 几十到上百毫秒，还要过 TLS，NAS 的上行也有限。
      1 秒分片意味着每秒要完成一次"请求 → 传输 → 解码"，追不上就落后；
      而直播窗口只有 12 秒，一落后 12 秒，想要的分片已经被删了，
      于是**永久卡死** —— 实测就是"显示一屏歌词然后不动了"。

    Apple 自己的 HLS 编写指南推荐 6 秒分片。1 秒只在 LL-HLS
    （带 partial segment 和阻塞式播放列表刷新）下成立，这套不是。

    判据用地址本身：私有网段或 .local 就是局域网，其它按公网算。
    宁可把局域网误判成公网 —— 那只是延迟高一点，反过来是彻底放不出来。
    """
    host = urlparse(public_base_url or "").hostname or ""
    if not host:
        return False
    if host.endswith(".local") or host == "localhost":
        return False
    try:
        return not ipaddress.ip_address(host).is_private
    except ValueError:
        # 不是 IP 就是域名。域名一般是对外的。
        return True


def stream_profile(wan: bool) -> dict:
    """按档位给出分片长度、直播窗口和帧率。

    窗口一律给到 40 秒以上：客户端偶尔卡一下也还能追回来，
    而不是掉出窗口之后再也回不来。

    帧率压到 15 是因为这块画面一句歌词才变一次，30fps 纯粹在烧上行带宽。
    """
    if wan:
        # keep_all：分片一律不删、播放列表列出全部。
        #
        # 这才是"外网投上去一屏就不动"的真正根因 —— 不是分片太短，是
        # delete_segments 会把滑出窗口的分片**删掉**。客户端一旦落后
        # （外网抖动一次就够），它要的分片已经不在磁盘上，之后再也追不
        # 回来，画面就永久停住。窗口从 12 秒拉到 48 秒只是让这件事晚点
        # 发生，没有解决它。
        #
        # 保留全部之后，落后多少都能继续拉，等于让接收端可以想缓冲多少
        # 缓冲多少。代价是磁盘：歌词画面几秒才变一次，几乎全是静止帧，
        # 一首歌压出来只有几 MB，会话结束时整个目录会被清掉。
        return {"segment": 4.0, "list_size": 0, "fps": 15, "keep_all": True, "lead": 45.0}
    return {
        "segment": settings.airplay_segment_seconds,
        "list_size": 12,
        "fps": settings.airplay_fps,
        "keep_all": False,
        "lead": 0.0,
    }


def build_ffmpeg_command(output_dir: Path, *, use_qsv: bool, profile: dict | None = None) -> list[str]:
    width, height = settings.airplay_width, settings.airplay_height
    chosen = profile or stream_profile(False)
    fps, segment = int(chosen["fps"]), float(chosen["segment"])
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
        str(int(chosen["list_size"])),
        "-hls_delete_threshold",
        "6",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_flags",
        (
            "independent_segments+program_date_time+temp_file"
            if chosen.get("keep_all")
            else "delete_segments+independent_segments+program_date_time+temp_file"
        ),
        "-hls_segment_filename",
        str(output_dir / "segment_%09d.m4s"),
        str(output_dir / "media.m3u8"),
    ]
    return command


# 能画汉字的字体候选，按优先级排。
#
# 原来的列表是：settings 里配的路径、一个 Noto CJK 固定路径、
# DejaVuSans、Windows 雅黑。三个问题：
#
#   1. DejaVu **没有 CJK 字形**。它在很多 Linux 发行版上都存在，
#      一旦 Noto 那条不命中就会选中它 —— 中文全是豆腐块。
#      "文件存在"和"能画汉字"是两件事，所以下面加了 _renders_cjk 探测。
#   2. 开发机（macOS）三条全不命中，退到 PIL 内置点阵字体，同样是豆腐块。
#      我就是这样第一次看到那一屏方框的。
#   3. 路径写死一个文件名。当前镜像（python:3.12-slim-bookworm +
#      fonts-noto-cjk）装出来确实是 NotoSansCJK-Regular.ttc，这一条今天
#      没坏；但换个基础镜像或者 Debian 升一版就可能变成
#      NotoSansCJK-VF.otf.ttc，而那时的表现同样是"静默出方框"。
#
# 这类失败最难查的地方在于：构建、启动、测试全绿，布局、进度、时间轴
# 全对，只有真正要看的那部分没了。所以现在多了 cjk_font_missing()——
# 找不到字体就不让投屏启动，并把原因说出来。
_CJK_FONT_CANDIDATES = (
    # Debian / Ubuntu：新版可变字重在前，老版固定字重在后
    "/usr/share/fonts/opentype/noto/NotoSansCJK-VF.otf.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    # Alpine
    "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
    # macOS（开发机）
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    # Windows
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
)

_CJK_BOLD_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-VF.otf.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
    "/System/Library/Fonts/PingFang.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
)

# 拿它探字体到底有没有 CJK 字形。存在但画不出汉字的字体（DejaVu）
# 必须被排除，否则等于没修。
_CJK_PROBE = "海"


def _renders_cjk(path: str) -> bool:
    """这个字体文件真的能画出汉字吗？

    只看文件存在是不够的：DejaVuSans.ttf 到处都有，但它一个汉字都没有。
    这里直接渲染一个"海"字，看有没有落墨 —— 缺字形时 FreeType 会给出
    一个空白（或 .notdef 方框）位图，getbbox() 返回 None 或极小的框。
    """
    try:
        font = ImageFont.truetype(path, size=64)
        mask = font.getmask(_CJK_PROBE, mode="L")
        box = mask.getbbox()
    except (OSError, TypeError, ValueError):
        return False
    if not box:
        return False
    # .notdef 通常是个空心方框，也有落墨。用"填充率"区分：
    # 真汉字笔画多、填充率高；空心方框只有四条边。
    width, height = box[2] - box[0], box[3] - box[1]
    if width < 8 or height < 8:
        return False
    inked = sum(1 for value in mask if value > 40)
    return inked / max(1, width * height) > 0.12


@lru_cache(maxsize=1)
def _font_path() -> str | None:
    """第一个真能画汉字的字体。找不到返回 None。"""
    candidates = (settings.airplay_font_path, *_CJK_FONT_CANDIDATES)
    for item in candidates:
        if item and Path(item).exists() and _renders_cjk(item):
            return item
    return None


@lru_cache(maxsize=1)
def _bold_font_path() -> str | None:
    for item in (settings.airplay_font_path, *_CJK_BOLD_CANDIDATES):
        if item and Path(item).exists() and _renders_cjk(item):
            return item
    return _font_path()


def cjk_font_missing() -> bool:
    """服务器上没有任何能画汉字的字体。

    投屏在这种情况下**不该启动**：它会输出一屏方框，用户看到的是
    "功能坏了"，而真正的原因（缺字体）在界面上完全看不出来。
    宁可开不了并说清原因。
    """
    return _font_path() is None


@lru_cache(maxsize=32)
def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    selected = _bold_font_path() if bold else _font_path()
    try:
        return ImageFont.truetype(selected, size=size) if selected else ImageFont.load_default(size=size)
    except (OSError, TypeError):
        return ImageFont.load_default()


def _accent_from_cover(cover: Image.Image | None, fallback: tuple) -> tuple[int, int, int]:
    """从封面里挑一个**看得出是颜色**的强调色。

    不能用均值：一张图的平均色几乎总是落在灰轴附近，拿去画进度条和
    来源胶囊，出来是灰的，整幅画就没有一处颜色把它串起来。

    做法是把封面量化成一小撮代表色，再按"够鲜艳 + 够亮 + 占比不能太小"
    挑一个。挑不出来（黑白封面这种）就退回均值提饱和 —— 那时候画面本来
    也不该硬塞一个颜色进去。
    """
    if cover is not None:
        try:
            small = cover.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)
            palette = small.quantize(colors=12, method=Image.Quantize.FASTOCTREE)
            counts = palette.getcolors() or []
            table = palette.getpalette() or []
            total = sum(count for count, _ in counts) or 1
            best, best_score = None, 0.0
            for count, index in counts:
                rgb = tuple(table[index * 3 : index * 3 + 3])
                if len(rgb) != 3:
                    continue
                high, low = max(rgb), min(rgb)
                if high < 60 or high > 246:
                    continue  # 太暗看不见，太亮等于白
                saturation = (high - low) / high
                share = count / total
                # 鲜艳度为主，亮度次之，占比只作为一点点加权：
                # 一块很鲜艳但只占 2% 的色（比如那枚红印章）也该有机会入选。
                score = saturation * 1.0 + (high / 255) * 0.35 + min(share, 0.35) * 0.5
                if saturation >= 0.22 and score > best_score:
                    best, best_score = rgb, score
            if best:
                high = max(best)
                lift = 210 / high if high < 210 else 1.0
                return tuple(max(48, min(255, int(channel * lift))) for channel in best)
        except Exception:
            pass
    base = max(1, sum(fallback) // 3)
    return tuple(max(60, min(255, int(base + (channel - base) * 2.6) + 34)) for channel in fallback)


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
    # 从封面提出来的强调色。底图画完时写进来，画歌词/进度条时复用 ——
    # 同一个颜色在一幅画里出现两次，画面才像是设计过的。
    accent: tuple = (226, 178, 88)
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
        # 没有中文字体就不要开。开了只会投出一屏方框，
        # 用户看到的是"功能坏了"，而真正的原因在界面上完全看不出来。
        if cjk_font_missing():
            raise RuntimeError(
                "服务器上没有能显示中文的字体，投出去的歌词会是一排方框。"
                "容器镜像里装一个 fonts-noto-cjk，或者用 AIRPLAY_FONT_PATH 指定字体文件。"
            )
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
        session = self.ensure_started(token)
        # 用这条会话自己的档位，别用默认值 —— 否则公网会话拿到的是
        # 局域网档的声明，跟实际编出来的流对不上。
        profile = stream_profile(
            wan_profile(getattr(session, "public_base_url", "") or "")
        )
        return build_master_playlist(profile)

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
        # 档位由这条会话的对外地址决定：公网走保守参数，局域网保持低延迟。
        profile = stream_profile(wan_profile(session.public_base_url))
        command = build_ffmpeg_command(
            session.output_dir, use_qsv=use_qsv, profile=profile
        )
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
        encoded_time = session.clock.position()
        idle = False
        try:
            while not session.stop_event.is_set() and process.poll() is None:
                if time.time() - session.last_stream_access_at > settings.airplay_stream_idle_seconds:
                    idle = True
                    break

                frame = self._render_frame(session, at=encoded_time)
                if process.stdin is None:
                    break
                process.stdin.write(frame.tobytes())
                wrote_frames += 1
                encoded_time += frame_interval

                """跑在播放前面，而不是卡着实时喂。

                歌词画面完全由时间轴决定，后面几十秒长什么样现在就知道，
                所以可以先编出来。编到领先 lead 秒之后再按实时节奏喂。

                配合"公网不删分片"，接收端就能囤下一大段，网络抖一下也
                不会断 —— 这是"先缓存到播放设备"能落地的前提。

                局域网 lead 给 0：那边要的是低延迟，提前编只会让
                seek 之后要丢掉的画面更多。
                """
                lead = float(profile.get("lead", 0))
                ahead = encoded_time - session.clock.position()
                if ahead < lead:
                    continue  # 还没编够，接着全速编
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

    def _render_frame(self, session: CastSession, at: float | None = None) -> Image.Image:
        """画一帧。

        `at` 是要画的**媒体时间**（秒）。不传就画"此刻"。

        传它是为了让编码器跑在播放前面：歌词画面完全由时间轴决定，
        给定时刻画出来的内容是确定的，所以可以提前把后面几十秒先编好。
        """
        with session.lock:
            if session.visual_base is None:
                session.visual_base = self._build_visual_base(session)
            image = session.visual_base.copy()
            state = dict(session.state)
            lines = list(session.lyrics)
            media_time = session.clock.position() if at is None else at
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
        accent = tuple(session.accent)
        left, right = int(width * 0.415), int(width * 0.94)
        if lines:
            #
            # 歌词的纵向节奏。
            #
            # 原来是 5 行钉在 20% / 35% / 50% / 65% / 79% 上 —— 从画面顶部
            # 一直铺到底部，行距比字号大得多，读起来是五条互不相干的字幕，
            # 而不是一首歌的连续几句。而且当前句只比别的大一点点，
            # 焦点不明确。
            #
            # 改成：**以当前句为中心、按字号推算行距**。当前句显著更大更亮，
            # 前后两句按距离递减地暗下去（255 → 132 → 58）。
            # 这是 Apple Music 全屏歌词那一套的做法，也是"看得出焦点"的关键。
            #
            active_size = max(34, int(height * 0.062))
            idle_size = max(26, int(height * 0.040))
            active_font = _font(active_size, bold=True)
            idle_font = _font(idle_size, bold=False)
            gap = int(idle_size * 2.15)          # 相邻两句之间的呼吸
            active_gap = int(active_size * 1.45)  # 当前句上下留得更宽，把它托出来
            center_y = int(height * 0.50)
            rows = []
            for offset in (-2, -1, 0, 1, 2):
                index = active + offset
                if offset == 0:
                    y = center_y
                elif offset < 0:
                    y = center_y - active_gap + (offset + 1) * gap
                else:
                    y = center_y + active_gap + (offset - 1) * gap
                rows.append((offset, index, y))
            max_width = right - left
            for offset, index, y in rows:
                if not 0 <= index < len(lines):
                    continue
                line = lines[index]
                is_active = offset == 0
                font = active_font if is_active else idle_font
                distance = abs(offset)
                alpha = 255 if is_active else (132 if distance == 1 else 58)
                text = _ellipsize(draw, line.text, font, max_width)
                if is_active:
                    # 当前句垫一层极淡的强调色辉光。不是描边 —— 描边在电视上
                    # 会显脏；辉光只是让这一行"亮起来"。
                    #
                    # 用灰度遮罩 paste，不用 alpha_composite：这一帧是 RGB
                    # （visual_base 最后 convert 过），而且 1080p × 15fps
                    # 每帧来回转 RGBA 太贵。
                    #
                    # 只模糊这一行占的那一小块，不要整帧模糊。
                    #
                    # 整帧 1920×1080 的高斯模糊每帧都做，在 NAS 那种 CPU 上
                    # 会直接吃掉 15fps 的预算（这台机器上单帧 22ms，预算 66ms，
                    # 余量不能这么花）。辉光只影响文字周围几十像素，
                    # 裁出来做完再贴回去，结果完全一样。
                    #
                    radius = max(6, height // 120)
                    bbox = draw.textbbox((left, y), text, font=font)
                    pad = radius * 3
                    region = (
                        max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                        min(width, bbox[2] + pad), min(height, bbox[3] + pad),
                    )
                    box_w, box_h = region[2] - region[0], region[3] - region[1]
                    if box_w > 0 and box_h > 0:
                        halo = Image.new("L", (box_w, box_h), 0)
                        ImageDraw.Draw(halo).text(
                            (left - region[0], y - region[1]), text, font=font, fill=96
                        )
                        halo = halo.filter(ImageFilter.GaussianBlur(radius))
                        image.paste(
                            Image.new("RGB", (box_w, box_h), accent), (region[0], region[1]), halo
                        )
                        draw = ImageDraw.Draw(image, "RGBA")
                if is_active and line.words:
                    cursor = left
                    for word in line.words:
                        sung = word.time <= lyric_time
                        draw.text(
                            (cursor, y), word.text, font=font,
                            fill=(255, 255, 255, 255) if sung else (255, 255, 255, 150),
                        )
                        cursor += draw.textlength(word.text, font=font)
                else:
                    draw.text((left, y), text, font=font, fill=(255, 255, 255, alpha))
        else:
            draw.text(
                (left, int(height * 0.50)), "歌词准备中",
                font=_font(int(height * 0.046), bold=True), fill=(255, 255, 255, 150),
            )

        #
        # 进度条：细一点、圆角、走强调色。
        #
        # 原来是 5px 的纯白条 —— 又粗又抢眼，还和画面里其它元素没有关系。
        # 细到 4px、填充用封面提出来的强调色，跟左边那枚来源胶囊呼应，
        # 整幅画就有了一条颜色线索。
        #
        bar_h = max(4, height // 260)
        bar_y = int(height * 0.905)
        draw.rounded_rectangle((left, bar_y, right, bar_y + bar_h), radius=bar_h, fill=(255, 255, 255, 38))
        ratio = min(1.0, display_time / duration) if duration else 0.0
        if ratio > 0:
            draw.rounded_rectangle(
                (left, bar_y, left + int((right - left) * ratio), bar_y + bar_h),
                radius=bar_h, fill=(*accent, 235),
            )
        small = _font(max(17, height // 54))
        draw.text((left, bar_y + int(height * 0.022)), self._format_time(display_time), font=small, fill=(255, 255, 255, 120))
        remaining = self._format_time(duration)
        draw.text((right - draw.textlength(remaining, font=small), bar_y + int(height * 0.022)), remaining, font=small, fill=(255, 255, 255, 120))
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
        glow_draw.ellipse((-width // 5, -height // 3, width // 2, height * 4 // 3), fill=(*sample, 82))
        glow_draw.ellipse((width // 2, height // 3, width * 6 // 5, height * 4 // 3), fill=(116, 79, 190, 46))
        glow = glow.filter(ImageFilter.GaussianBlur(max(50, width // 16)))
        image = Image.alpha_composite(background.convert("RGBA"), glow)

        #
        # 左右分栏用**渐变**，不能用两块矩形。
        #
        # 原来是 `rectangle(0..0.36)` 加 `rectangle(0.34..width)` 两块平涂，
        # 交界处直接是一条硬竖缝 —— 1080p 投到电视上那条缝非常明显，
        # 整张图立刻显得廉价。渐变是一列一列画的，没有边界可言。
        #
        shade = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        shade_draw = ImageDraw.Draw(shade, "RGBA")
        split = width * 0.35
        span = width * 0.22  # 过渡带宽度：越宽越看不出分栏，太宽又压不住文字底
        for x in range(width):
            ratio = min(1.0, max(0.0, (x - (split - span / 2)) / span))
            # 左栏压暗一点让封面浮起来，右栏只要一层极淡的冷色垫住歌词
            alpha = int(84 * (1 - ratio) + 34 * ratio)
            tint = (0, 0, 0) if ratio < 0.5 else (4, 5, 9)
            shade_draw.line((x, 0, x, height), fill=(*tint, alpha))
        image = Image.alpha_composite(image, shade)

        # 四周压暗（vignette）。电视是大面积发光，边角不收一下会显得散。
        vignette = Image.new("L", (width, height), 0)
        ImageDraw.Draw(vignette).ellipse(
            (-width * 0.25, -height * 0.35, width * 1.25, height * 1.35), fill=255
        )
        vignette = vignette.filter(ImageFilter.GaussianBlur(width // 12))
        dark = Image.new("RGBA", (width, height), (0, 0, 0, 132))
        image = Image.composite(image, Image.alpha_composite(image, dark), vignette)
        accent = _accent_from_cover(session.cover, sample)
        cover_size = int(min(width * 0.255, height * 0.46))
        cover_x, cover_y = int(width * 0.072), int(height * 0.175)
        radius = width // 70

        #
        # 封面外框必须画在**独立的透明层**上再 alpha_composite。
        #
        # ImageDraw.Draw(im, "RGBA") 的行为是**替换**像素（连 alpha 一起写），
        # 不是把颜色叠加到已有内容上。所以直接在 image 上
        # draw.rounded_rectangle(fill=(0,0,0,96)) 写进去的是"黑色 + alpha 96"，
        # 而这张图交给 ffmpeg 之前会转成 RGB、alpha 被丢掉 ——
        # 于是"淡淡的投影"变成纯黑边框，"5% 白的占位块"变成纯白方块。
        # 上面 glow 和 shade 两层就是这么做对的，这一块当时漏了。
        #
        #
        # 封面只要**一层柔和的投影**，不要外框。
        #
        # 原来画了两个带白描边的圆角矩形，一个套一个 —— 在电视上看就是
        # "画框里又套了个画框"，很廉价。改成一层高斯模糊的投影，
        # 封面自然浮起来；描边只在封面自身边缘留极淡的一道，用来跟
        # 背景切开，而不是当装饰。
        #
        shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ImageDraw.Draw(shadow, "RGBA").rounded_rectangle(
            (cover_x - 6, cover_y + 26, cover_x + cover_size + 6, cover_y + cover_size + 34),
            radius=radius + 6, fill=(0, 0, 0, 150),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(18, width // 90)))
        image = Image.alpha_composite(image, shadow)
        chrome = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        chrome_draw = ImageDraw.Draw(chrome, "RGBA")
        if not session.cover:
            # 缺封面时的占位。和网页端 Cover 组件同一个思路：
            # 低饱和底色 + 曲名首字。
            #
            # 原来画的是 "♪"。镜像里的 Noto Sans CJK 确实有这个字形
            # （在容器里验过：U+266A 有 bbox、填充率 0.25），所以那不是 bug，
            # 只是每首歌都一样、什么信息都不给。换成首字：既有辨识度，
            # 又和网页端的占位一致，而且一定画得出来。
            chrome_draw.rounded_rectangle(
                (cover_x, cover_y, cover_x + cover_size, cover_y + cover_size),
                radius=width // 80, fill=(255, 255, 255, 20),
            )
        image = Image.alpha_composite(image, chrome)
        draw = ImageDraw.Draw(image, "RGBA")

        if session.cover:
            cover = _fit_cover(session.cover, (cover_size, cover_size))
            mask = Image.new("L", (cover_size, cover_size), 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, cover_size, cover_size), radius=width // 80, fill=255)
            image.paste(cover, (cover_x, cover_y), mask)
        else:
            initial = (str(session.state.get("title") or "").strip() or "音")[0]
            initial_font = _font(int(cover_size * 0.42), bold=True)
            box = draw.textbbox((0, 0), initial, font=initial_font)
            draw.text(
                (
                    cover_x + (cover_size - (box[2] - box[0])) / 2 - box[0],
                    cover_y + (cover_size - (box[3] - box[1])) / 2 - box[1],
                ),
                initial,
                font=initial_font,
                fill=(255, 255, 255, 92),
            )
        state = session.state
        label = _font(max(16, height // 58), bold=True)
        title_font = _font(max(30, height // 26), bold=True)
        meta_font = _font(max(20, height // 40))
        info_width = int(width * 0.30)
        info_center = cover_x + cover_size // 2
        title = _ellipsize(draw, state.get("title") or "等待播放", title_font, info_width)
        title_x = info_center - int(draw.textlength(title, font=title_font) / 2)
        # 与封面的间距收紧（原来 0.09 高，中间空一大块，标题像掉队了）
        title_y = cover_y + cover_size + int(height * 0.058)
        draw.text((title_x, title_y), title, font=title_font, fill=(255, 255, 255, 250))
        meta = f"{state.get('artist') or '未知歌手'}  ·  {state.get('album') or '未知专辑'}"
        meta = _ellipsize(draw, meta, meta_font, info_width)
        meta_x = info_center - int(draw.textlength(meta, font=meta_font) / 2)
        draw.text((meta_x, title_y + int(height * 0.052)), meta, font=meta_font, fill=(255, 255, 255, 150))

        #
        # 来源做成一枚带强调色的胶囊，而不是一行灰字。
        #
        # 整幅画面原来全是白字压在灰底上，没有任何一处颜色把它串起来。
        # 强调色取自封面（下面进度条用的是同一个），一幅画里出现两次同一个
        # 颜色，就有"设计过"的样子了。
        #
        quality_text = (state.get("quality") or "LYRICS CAST").upper()
        pill_w = int(draw.textlength(quality_text, font=label)) + int(width * 0.026)
        pill_h = int(height * 0.038)
        pill_x = info_center - pill_w // 2
        pill_y = title_y + int(height * 0.108)
        pill = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ImageDraw.Draw(pill, "RGBA").rounded_rectangle(
            (pill_x, pill_y, pill_x + pill_w, pill_y + pill_h),
            radius=pill_h // 2, fill=(*accent, 42), outline=(*accent, 120), width=2,
        )
        image = Image.alpha_composite(image, pill)
        draw = ImageDraw.Draw(image, "RGBA")
        box = draw.textbbox((0, 0), quality_text, font=label)
        draw.text(
            (info_center - (box[2] - box[0]) / 2 - box[0], pill_y + (pill_h - (box[3] - box[1])) / 2 - box[1]),
            quality_text, font=label, fill=(*accent, 255),
        )
        session.accent = accent
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
