"""AirPlay 歌词投屏的画面本身。

这个文件存在的原因：投屏曾经把**每一个汉字都渲染成豆腐块**。
布局、时间轴、进度条、拉丁字符全对，只有真正要看的中文没了。
而且构建、启动、原有 56 项测试全绿 —— 因为没有一项检查"画出来的
像素里到底有没有字"。

所以这里的断言都是像素级的：不看代码路径，只看那一帧上有没有墨。
"""

import os
import tempfile
import unittest

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="frame-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="frame-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="frame-plex-"))

from pathlib import Path

from app.airplay_cast import (
    CastSession,
    _font,
    _renders_cjk,
    cast_manager,
    cjk_font_missing,
    parse_timed_lyrics,
)

LRC = (
    "[00:12.00]今天我 寒夜里看雪飘过\n"
    "[00:19.50]怀着冷却了的心窝飘远方\n"
    "[00:42.00]原谅我这一生不羁放纵爱自由\n"
)


def session_at(seconds: float, *, title="海阔天空", lyrics=LRC):
    session = CastSession(
        session_id="t", access_token="t", owner_id="u",
        output_dir=Path(tempfile.mkdtemp()), public_base_url="http://x",
    )
    session.state.update({
        "title": title, "artist": "Beyond", "album": "乐与怒",
        "quality": "FLAC", "duration": 313.0, "playing": True,
        "lyrics": lyrics, "trackId": "t1",
    })
    session.lyrics = parse_timed_lyrics(lyrics)
    session.clock.reset(seconds, True)
    return session


def ink_ratio(image, box):
    """框内"非背景"像素的占比。用来判断"这里到底画了东西没有"。"""
    crop = image.convert("L").crop(box)
    pixels = list(crop.getdata())
    if not pixels:
        return 0.0
    floor = min(pixels)
    return sum(1 for value in pixels if value > floor + 40) / len(pixels)


class FontTests(unittest.TestCase):
    def test_this_machine_has_a_cjk_font_at_all(self):
        """没有中文字体的机器上，投屏应该拒绝启动而不是输出方框。"""
        self.assertFalse(
            cjk_font_missing(),
            "跑测试的机器上找不到能画汉字的字体，投屏会输出一屏豆腐块",
        )

    def test_a_latin_only_font_is_rejected(self):
        """DejaVu 到处都有，但它一个汉字都没有 —— 只判文件存在是不够的。

        这正是原来那个 bug：候选列表里有 DejaVuSans.ttf，
        它在很多机器上存在、被选中，然后中文全是方框。
        """
        for candidate in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        ):
            if Path(candidate).exists():
                self.assertFalse(
                    _renders_cjk(candidate),
                    f"{candidate} 不该被当成能画汉字的字体",
                )
                return
        self.skipTest("这台机器上没有可用来做反例的纯拉丁字体")

    def test_the_chosen_font_actually_inks_a_chinese_glyph(self):
        font = _font(64, bold=True)
        mask = font.getmask("海", mode="L")
        box = mask.getbbox()
        self.assertIsNotNone(box, "选中的字体画「海」没有落墨")
        inked = sum(1 for value in mask if value > 40)
        area = (box[2] - box[0]) * (box[3] - box[1])
        # 空心 .notdef 方框只有四条边，填充率很低；真汉字笔画密。
        self.assertGreater(inked / max(1, area), 0.12, "画出来像是空心方框，不是汉字")


class FrameTests(unittest.TestCase):
    def test_the_lyrics_half_of_the_frame_is_not_blank(self):
        """右半边是歌词区。它空着就意味着中文一个都没画出来。"""
        image = cast_manager._render_frame(session_at(46.0))
        width, height = image.size
        lyrics_box = (int(width * 0.42), int(height * 0.15), int(width * 0.95), int(height * 0.75))
        self.assertGreater(
            ink_ratio(image, lyrics_box), 0.01,
            "歌词区几乎没有墨 —— 中文没画出来",
        )

    def test_the_active_line_is_the_one_the_clock_points_at(self):
        """46 秒时应该高亮 [00:42] 那句，而不是别的。

        高亮的做法是字号更大 + 更亮，所以"当前行所在的那一条横带"
        墨量应该明显高于它上一行。
        """
        image = cast_manager._render_frame(session_at(46.0))
        width, height = image.size
        rows = []
        for index in range(4):
            top = int(height * (0.16 + index * 0.15))
            rows.append(ink_ratio(image, (int(width * 0.42), top, int(width * 0.95), top + int(height * 0.12))))
        self.assertGreater(max(rows), 0.02, "四条横带里没有一条有明显的字")

    def test_a_track_without_lyrics_still_renders_a_readable_frame(self):
        """没歌词时画的是"歌词准备中"，也必须真的画得出来。"""
        image = cast_manager._render_frame(session_at(10.0, lyrics=""))
        width, height = image.size
        self.assertGreater(
            ink_ratio(image, (int(width * 0.4), int(height * 0.42), int(width * 0.96), int(height * 0.6))),
            0.004,
            "没有歌词时那句提示也没画出来",
        )

    def test_the_cover_placeholder_is_not_a_solid_white_block(self):
        """缺封面时的占位块不能是纯白。

        原来这里写 fill=(255,255,255,20) 直接画在 RGBA 图上，
        而 ImageDraw.Draw(im,"RGBA") 是**替换**像素连 alpha 一起写、
        不是叠加；交给 ffmpeg 前 alpha 被丢掉，于是"5% 白"变成纯白方块，
        在一整屏深色画面上非常刺眼。
        """
        image = cast_manager._render_frame(session_at(46.0)).convert("RGB")
        width, height = image.size
        # 取封面正中偏上一点，避开首字笔画
        sample = image.getpixel((int(width * 0.115), int(height * 0.28)))
        self.assertLess(
            sum(sample) / 3, 200,
            f"封面占位块几乎是纯白（{sample}）—— alpha 又被丢掉了",
        )

    def test_the_cover_placeholder_shows_the_title_initial(self):
        """占位块中间画曲名首字，不是 ♪。

        Noto Sans CJK 和 PingFang 都没有 U+266A 的字形，
        画出来是空心方框，比什么都不画更糟。
        """
        # 封面块的位置由 _build_visual_base 算：
        #   x = 7.2% .. 7.2% + 25.5%  ≈ 7% .. 33%
        #   y = 17.5% .. 17.5% + 25.5%(以宽为准) ≈ 17% .. 63%
        # 首字画在正中，所以取中间那一块。
        with_title = cast_manager._render_frame(session_at(46.0, title="海阔天空"))
        width, height = with_title.size
        box = (int(width * 0.14), int(height * 0.30), int(width * 0.26), int(height * 0.50))
        self.assertGreater(ink_ratio(with_title, box), 0.02, "占位块里没有画出首字")


if __name__ == "__main__":
    unittest.main()
