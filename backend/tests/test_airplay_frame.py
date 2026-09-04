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


class VisualQualityTests(unittest.TestCase):
    """投屏画面的几条视觉约定。

    用户看完实机反馈"不够高级精美"，这几条是当时逐条改掉的问题 ——
    它们都是像素级可验的，不必靠眼睛记住。
    """

    def test_no_hard_vertical_seam_between_the_two_columns(self):
        """左右分栏必须是渐变，不能是两块平涂矩形拼出来的硬缝。

        原来是 rectangle(0..0.36) + rectangle(0.34..width) 两块平涂，
        交界处一条竖缝，1080p 投到电视上非常明显，整张图立刻显得廉价。
        """
        session = session_at(20.0)
        frame = cast_manager._render_frame(session, at=20.0).convert("L")
        width, height = frame.size
        # 取一条不经过任何文字的扫描线（很靠上），逐列看亮度跳变
        row = height // 22
        values = [frame.getpixel((x, row)) for x in range(width)]
        jumps = [
            (x, abs(values[x] - values[x - 1]))
            for x in range(int(width * 0.20), int(width * 0.55))
        ]
        worst_x, worst = max(jumps, key=lambda item: item[1])
        self.assertLessEqual(
            worst, 6,
            f"第 {worst_x} 列出现 {worst} 级亮度跳变 —— 分栏那里又变成硬边了",
        )

    def test_the_active_line_is_clearly_the_focus(self):
        """当前句必须明显比相邻句更亮更大，否则看不出焦点在哪。"""
        session = session_at(20.0)
        frame = cast_manager._render_frame(session, at=20.0)
        width, height = frame.size
        lyric_left, lyric_right = int(width * 0.41), int(width * 0.95)
        # 当前句在纵向正中，相邻句在它上下
        active = ink_ratio(frame, (lyric_left, int(height * 0.46), lyric_right, int(height * 0.58)))
        neighbour = ink_ratio(frame, (lyric_left, int(height * 0.34), lyric_right, int(height * 0.44)))
        self.assertGreater(active, 0.02, "当前句这一带没有墨")
        self.assertGreater(
            active, neighbour * 1.4,
            f"当前句({active:.3f})没有比相邻句({neighbour:.3f})突出，焦点不明确",
        )

    def test_the_accent_colour_comes_from_the_cover_and_is_actually_a_colour(self):
        """强调色要从封面里挑，而且不能是灰的。

        原来用封面均值 —— 均值几乎总落在灰轴上，画出来的进度条和来源
        胶囊看起来没有颜色，整幅画就少了那条把它串起来的线索。
        """
        from PIL import Image as PILImage
        from app.airplay_cast import _accent_from_cover

        cover = PILImage.new("RGB", (64, 64), (40, 44, 48))
        # 一小块很鲜艳的红，占比不到 6% —— 也应该被挑中
        for x in range(64):
            for y in range(58, 64):
                cover.putpixel((x, y), (198, 46, 40))
        accent = _accent_from_cover(cover, (80, 80, 80))
        high, low = max(accent), min(accent)
        self.assertGreater(
            (high - low) / max(1, high), 0.30,
            f"选出来的 {accent} 太接近灰色，看不出是颜色",
        )
        self.assertEqual(accent.index(max(accent)), 0, "红色封面应该挑出偏红的强调色")

    def test_a_greyscale_cover_does_not_get_a_fake_colour(self):
        """黑白封面就不该硬塞一个颜色进去 —— 挑不出来时退回均值。"""
        from PIL import Image as PILImage
        from app.airplay_cast import _accent_from_cover

        accent = _accent_from_cover(PILImage.new("RGB", (64, 64), (128, 128, 128)), (128, 128, 128))
        high, low = max(accent), min(accent)
        self.assertLessEqual((high - low) / max(1, high), 0.12, f"{accent} 是凭空造的颜色")

    def test_rendering_a_frame_stays_well_inside_the_frame_budget(self):
        """15fps 的预算是 66.7 毫秒。加视觉效果不能把余量吃掉 ——
        当前句那层辉光一度是整帧高斯模糊，单帧从 11ms 涨到 22ms。"""
        import time

        session = session_at(20.0)
        session.visual_base = cast_manager._build_visual_base(session)
        start = time.perf_counter()
        for index in range(10):
            cast_manager._render_frame(session, at=20.0 + index / 15)
        per_frame = (time.perf_counter() - start) / 10
        self.assertLess(
            per_frame, 0.045,
            f"单帧 {per_frame * 1000:.0f} 毫秒，离 66.7 毫秒的预算太近了",
        )


class PlaylistStartTests(unittest.TestCase):
    """播放列表必须告诉播放器从哪儿开始播。

    这是"投过去只有一条进度条、歌词自己跳动、延迟严重"的根因：
    编码器为了扛公网抖动会提前 45 秒把画面编好囤着，而且刻意不删分片，
    但播放列表里没有 `#EXT-X-START` —— Apple TV 就从很靠前的位置起播，
    放的是投屏之前那段"等待播放"的空画面，之后一直落后几十秒。
    画面本身一直是对的，只是电视放的不是"现在"。
    """

    PLAYLIST = (
        "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n"
        "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n"
        '#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.000000,\nsegment_000000000.m4s\n'
    )

    def _playlist(self, public_base_url):
        import tempfile
        from unittest.mock import patch as mock_patch

        output = Path(tempfile.mkdtemp())
        (output / "media.m3u8").write_text(self.PLAYLIST, encoding="utf-8")
        session = CastSession(
            session_id="s", access_token="tok", owner_id="u",
            output_dir=output, public_base_url=public_base_url,
        )
        with (
            mock_patch.object(cast_manager, "ensure_started", return_value=session),
            mock_patch.object(cast_manager, "wait_for_playlist", return_value=output / "media.m3u8"),
        ):
            return cast_manager.media_playlist("tok").decode("utf-8")

    def test_public_playlist_starts_at_now_not_at_the_beginning(self):
        text = self._playlist("https://sla.example.cn")
        self.assertIn("#EXT-X-START:", text, "公网播放列表没有起播点，电视会从最前面开始放")
        line = next(item for item in text.splitlines() if item.startswith("#EXT-X-START:"))
        offset = float(line.split("TIME-OFFSET=")[1].split(",")[0])
        # 提前编 45 秒，就该从直播边缘往回约 45 秒起播 —— 那里正好是"此刻"
        self.assertLess(offset, -30, f"起播点 {offset} 太靠近直播边缘，电视会播到未来的画面")
        self.assertGreater(offset, -46, f"起播点 {offset} 比囤的还早，会播到投屏之前的空画面")
        # 必须插在第一个分片之前，否则播放器读不到
        lines = text.splitlines()
        self.assertLess(
            lines.index(line),
            next(i for i, item in enumerate(lines) if item.startswith("#EXTINF")),
        )

    def test_lan_playlist_is_left_alone(self):
        """局域网 lead 是 0（要的就是低延迟），没什么可偏移的。"""
        text = self._playlist("http://192.168.1.10:32783")
        self.assertNotIn("#EXT-X-START", text)

    def test_an_existing_start_tag_is_not_duplicated(self):
        import tempfile
        from unittest.mock import patch as mock_patch

        output = Path(tempfile.mkdtemp())
        (output / "media.m3u8").write_text(
            self.PLAYLIST.replace("#EXT-X-MAP", "#EXT-X-START:TIME-OFFSET=-9\n#EXT-X-MAP"),
            encoding="utf-8",
        )
        session = CastSession(
            session_id="s", access_token="tok", owner_id="u",
            output_dir=output, public_base_url="https://sla.example.cn",
        )
        with (
            mock_patch.object(cast_manager, "ensure_started", return_value=session),
            mock_patch.object(cast_manager, "wait_for_playlist", return_value=output / "media.m3u8"),
        ):
            text = cast_manager.media_playlist("tok").decode("utf-8")
        self.assertEqual(text.count("#EXT-X-START"), 1)
