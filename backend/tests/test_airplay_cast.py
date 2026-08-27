import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="airplay-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="airplay-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="airplay-plex-"))

from app.airplay_cast import (
    AirPlayCastManager,
    ClockDiscipline,
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
        self.assertIn("delete_segments+independent_segments+program_date_time+temp_file", command)
        self.assertNotIn("-hls_playlist_type", command)

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
                "lyricsOffsetMs": 750,
            }
            manager.update(session.session_id, "listener-1", first)
            second = {**first, "trackId": "local_file:2", "title": "第二首", "position": 0}
            status = manager.update(session.session_id, "listener-1", second)
            self.assertEqual(status["streamUrl"], first_url)
            self.assertEqual(status["encoderStarts"], 0)
            self.assertEqual(status["trackRevision"], 2)
            self.assertEqual(status["lyricsOffsetMs"], 750)
            self.assertEqual(status["remoteControlMode"], "html-media-transport-bridge")
            self.assertIs(manager.create("listener-1", "https://music.example.test"), session)
            manager.stop(session.session_id, "listener-1")


if __name__ == "__main__":
    unittest.main()
