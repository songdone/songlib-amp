import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="airplay-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="airplay-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="airplay-plex-"))

from app.airplay_cast import (
    AirPlayCastManager,
    ClockDiscipline,
    build_master_playlist,
    build_ffmpeg_command,
    parse_timed_lyrics,
)


class AirPlayCastTests(unittest.TestCase):
    def test_regular_lrc_highlights_complete_lines(self):
        lines = parse_timed_lyrics("[00:01.00]第一句\n[00:03.50]第二句")
        self.assertEqual([(line.time, line.text) for line in lines], [(1.0, "第一句"), (3.5, "第二句")])
        self.assertEqual(lines[0].words, ())

    def test_enhanced_lrc_preserves_true_word_timestamps(self):
        lines = parse_timed_lyrics("[00:10.00]<00:10.00>逐<00:10.24>字<00:10.51>歌词")
        self.assertEqual(lines[0].text, "逐字歌词")
        self.assertEqual(
            [(word.time, word.text) for word in lines[0].words],
            [(10.0, "逐"), (10.24, "字"), (10.51, "歌词")],
        )

    def test_clock_uses_gentle_drift_then_hard_resync(self):
        clock = ClockDiscipline(gain=0.5, max_step_seconds=0.2, hard_sync_seconds=2.0)
        clock.reset(10.0, True, at=100.0)
        corrected = clock.update(11.5, True, at=101.0)
        self.assertAlmostEqual(corrected, 11.2)
        self.assertAlmostEqual(clock.last_error, 0.5)
        corrected = clock.update(20.0, True, at=102.0)
        self.assertEqual(corrected, 20.0)

    def test_ffmpeg_command_builds_short_fmp4_live_window(self):
        command = build_ffmpeg_command(Path("/tmp/cast"), use_qsv=False)
        joined = " ".join(command)
        self.assertIn("libx264", command)
        self.assertIn("-hls_segment_type fmp4", joined)
        self.assertIn("-hls_time 1", joined)
        self.assertIn("anullsrc=channel_layout=stereo:sample_rate=48000", command)
        self.assertIn("-c:a aac", joined)
        self.assertIn("-bf 0", joined)
        self.assertIn("-flags +cgop", joined)
        self.assertIn("-tune zerolatency", joined)
        self.assertIn("-preset ultrafast", joined)
        self.assertNotIn("-an", command)
        self.assertIn("delete_segments+independent_segments+program_date_time+temp_file", command)
        self.assertNotIn("-hls_playlist_type", command)

    def test_master_playlist_advertises_video_and_aac(self):
        playlist = build_master_playlist()
        self.assertIn("#EXT-X-INDEPENDENT-SEGMENTS", playlist)
        self.assertIn("avc1.640029,mp4a.40.2", playlist)
        self.assertIn("RESOLUTION=1920x1080", playlist)

    def test_track_switch_keeps_session_url_and_does_not_start_new_encoder(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = AirPlayCastManager(Path(directory))
            session = manager.create("listener-1", "https://music.example.test")
            first_url = session.stream_url
            first = {
                "trackId": "local_file:1",
                "title": "第一首",
                "artist": "歌手",
                "album": "专辑",
                "quality": "original",
                "lyrics": "[00:01.00]第一句",
                "position": 0,
                "duration": 180,
                "playing": True,
                "coverKey": "/cover/1",
                "lyricsOffsetMs": 750,
                "transportLatencyMs": 1350,
            }
            manager.update(session.session_id, "listener-1", first)
            second = {**first, "trackId": "local_file:2", "title": "第二首", "position": 0}
            status = manager.update(session.session_id, "listener-1", second)
            self.assertEqual(status["streamUrl"], first_url)
            self.assertEqual(status["encoderStarts"], 0)
            self.assertEqual(status["trackRevision"], 2)
            self.assertEqual(status["lyricsOffsetMs"], 750)
            self.assertEqual(status["transportLatencyMs"], 1350)
            self.assertEqual(status["audioMode"], "dual-clock-silent-aac")
            self.assertEqual(status["remoteControlMode"], "continuous-hls-media-session")
            self.assertIs(manager.create("listener-1", "https://music.example.test"), session)
            manager.stop(session.session_id, "listener-1")

    def test_late_cover_identity_invalidates_visual_without_track_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = AirPlayCastManager(Path(directory))
            session = manager.create("listener-1", "https://music.example.test")
            payload = {
                "trackId": "plex_session:42",
                "title": "歌曲",
                "artist": "歌手",
                "album": "专辑",
                "position": 0,
                "duration": 180,
                "playing": True,
                "coverKey": "",
            }
            manager.update(session.session_id, "listener-1", payload)
            self.assertFalse(
                manager.visual_changed(session.session_id, "listener-1", payload["trackId"], "")
            )
            self.assertTrue(
                manager.visual_changed(
                    session.session_id,
                    "listener-1",
                    payload["trackId"],
                    "/api/plex/image?path=thumb",
                )
            )
            manager.stop(session.session_id, "listener-1")

    def test_clock_heartbeat_preserves_metadata_and_large_lyrics(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = AirPlayCastManager(Path(directory))
            session = manager.create("listener-1", "https://music.example.test")
            lyrics = "[00:01.00]第一句\n[00:04.00]第二句"
            manager.update(
                session.session_id,
                "listener-1",
                {
                    "trackId": "plex_session:42",
                    "title": "歌曲",
                    "artist": "歌手",
                    "album": "专辑",
                    "quality": "Plex",
                    "lyrics": lyrics,
                    "position": 1,
                    "duration": 180,
                    "playing": True,
                },
            )
            manager.update_clock(
                session.session_id,
                "listener-1",
                {
                    "position": 8.5,
                    "duration": 180,
                    "playing": True,
                    "lyricsOffsetMs": 250,
                    "transportLatencyMs": 1500,
                },
            )
            self.assertEqual(session.state["title"], "歌曲")
            self.assertEqual(session.state["lyrics"], lyrics)
            self.assertEqual(len(session.lyrics), 2)
            self.assertEqual(session.state["lyricsOffsetMs"], 250)
            self.assertEqual(session.state["transportLatencyMs"], 1500)
            manager.stop(session.session_id, "listener-1")


if __name__ == "__main__":
    unittest.main()


class PublicBaseUrlTests(unittest.TestCase):
    """投屏地址必须跟着"浏览器用哪个地址进来的"走。

    这条是外网使用时唯一能让投屏跑通的前提：Apple TV 自己去拉 HLS，
    所以那个地址必须是 Apple TV 够得着的 —— 也就是浏览器刚用过的那个。
    写死内网 IP 的话，人在外网时 Apple TV 解析不到，投屏必然失败。
    """

    @staticmethod
    def _request(scheme, host, headers=None):
        from starlette.requests import Request

        raw = [(b"host", host.encode())]
        for key, value in (headers or {}).items():
            raw.append((key.encode(), value.encode()))
        return Request(
            {
                "type": "http",
                "method": "POST",
                "scheme": scheme,
                "server": (host.split(":")[0], 8080),
                "path": "/api/airplay/cast",
                "query_string": b"",
                "headers": raw,
            }
        )

    def test_follows_the_host_the_browser_used(self):
        from app.main import _airplay_public_base

        with patch("app.main.settings") as fake:
            fake.airplay_public_base_url = ""
            base = _airplay_public_base(self._request("http", "192.168.31.28:32783"))
        self.assertEqual(base, "http://192.168.31.28:32783")

    def test_https_reverse_proxy_yields_https(self):
        """反代卸载 TLS 之后 scheme 是内网 http，直接用会拼出 http:// 前缀，
        而页面是 https —— 混合内容被拦，<video> 根本加载不了。"""
        from app.main import _airplay_public_base

        with patch("app.main.settings") as fake:
            fake.airplay_public_base_url = ""
            base = _airplay_public_base(
                self._request(
                    "http",
                    "sla.playsong.cn",
                    {"x-forwarded-proto": "https", "x-forwarded-host": "sla.playsong.cn"},
                )
            )
        self.assertEqual(base, "https://sla.playsong.cn")

    def test_explicit_override_still_wins(self):
        from app.main import _airplay_public_base

        with patch("app.main.settings") as fake:
            fake.airplay_public_base_url = "https://cast.example.com"
            base = _airplay_public_base(self._request("http", "192.168.31.28:32783"))
        self.assertEqual(base, "https://cast.example.com")


class StreamProfileTests(unittest.TestCase):
    """投屏参数必须跟着网络走。

    实测症状：外网投到 MacMini 只显示一屏歌词然后卡死，投到 Apple TV
    毫无反应。原因是参数是给局域网调的 —— 1 秒分片、12 秒直播窗口。
    公网上客户端一落后 12 秒，要的分片已经被 delete_segments 删掉，
    再也追不回来。
    """

    def test_private_addresses_keep_the_low_latency_profile(self):
        from app.airplay_cast import stream_profile, wan_profile

        for url in (
            "http://192.168.31.28:32783",
            "http://10.0.0.5:8080",
            "http://172.16.3.9:80",
            "http://nas.local:32783",
            "http://localhost:8080",
        ):
            with self.subTest(url):
                self.assertFalse(wan_profile(url), f"{url} 应判为局域网")

    def test_public_hosts_get_the_conservative_profile(self):
        from app.airplay_cast import stream_profile, wan_profile

        for url in ("https://sla.playsong.cn", "https://1.2.3.4:443"):
            with self.subTest(url):
                self.assertTrue(wan_profile(url), f"{url} 应判为公网")
        wan = stream_profile(True)
        self.assertGreaterEqual(wan["segment"], 3.0, "公网分片不能再是 1 秒")
        self.assertLessEqual(wan["fps"], 15, "一句歌词才变一次，30fps 是在烧上行")
        window = wan["segment"] * wan["list_size"]
        self.assertGreaterEqual(
            window, 40, f"直播窗口只有 {window} 秒，客户端落后一次就再也追不回来"
        )

    def test_the_window_is_what_actually_reaches_ffmpeg(self):
        """光有档位不算，得真的写进 ffmpeg 参数里。"""
        from app.airplay_cast import build_ffmpeg_command, stream_profile

        cmd = build_ffmpeg_command(
            Path("/tmp/cast-profile-test"), use_qsv=False, profile=stream_profile(True)
        )
        self.assertIn("-hls_time", cmd)
        self.assertEqual(cmd[cmd.index("-hls_time") + 1], "4")
        self.assertEqual(cmd[cmd.index("-hls_list_size") + 1], "12")
        # 注意别断言 -framerate：那是**输入端**往管道推帧的速率
        # （airplay_render_fps，默认 4），跟输出帧率是两回事。
        # 第一版断在它上面，读到 4 以为参数没传进去，其实是断错了参数。
        # 输出帧率写在 -vf 的 fps= 里，gop 由 fps × segment 推出来。
        self.assertIn("fps=15", cmd[cmd.index("-vf") + 1], "输出帧率要跟着档位")
        self.assertEqual(cmd[cmd.index("-g") + 1], "60", "gop 应是 15×4")

    def test_the_playlist_advertises_the_real_frame_rate(self):
        """播放列表声明的帧率必须和实际编出来的一致。

        原来这里写死 settings.airplay_fps（30），公网档实际是 15 ——
        客户端按声明准备解码，声明和流对不上本身就是故障源。
        """
        from app.airplay_cast import build_master_playlist, stream_profile

        self.assertIn("FRAME-RATE=15.000", build_master_playlist(stream_profile(True)))
        self.assertIn("FRAME-RATE=30.000", build_master_playlist(stream_profile(False)))
