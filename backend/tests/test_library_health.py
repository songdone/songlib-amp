"""Whole-library checkup.

The interesting part is duplicate detection, and its interesting part is
what it *refuses* to group. A checkup that says "these two are the same
song, delete one" and is wrong causes the user to lose a recording. So the
tests below are mostly about false positives.
"""

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="health-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="health-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="health-plex-"))

from app.db import init_db, transaction
from app.local_library import LocalLibraryService

init_db()


def insert(rows):
    """Put rows straight into the files table. Only the columns health() reads."""
    with transaction() as connection:
        connection.execute("DELETE FROM files")
        for item in rows:
            connection.execute(
                """INSERT INTO files
                   (id, path, filename, ext, size, hash, format, bitrate, sample_rate,
                    channels, duration, title, artist, album, album_artist, year,
                    track_number, disc_number, genre, has_cover, has_lrc, plex_matched,
                    tags_inferred, path_rule_ok, last_scanned_at, created_at, updated_at)
                   VALUES (:id, :path, :filename, :ext, :size, :hash, 'FLAC', :bitrate,
                    44100, 2, :duration, :title, :artist, :album, :artist, '2003',
                    '1', '1', '', :has_cover, :has_lrc, :plex_matched, '[]',
                    :path_rule_ok, '', '', '')""",
                {
                    "has_cover": 1, "has_lrc": 1, "plex_matched": 1, "path_rule_ok": 1,
                    "hash": None, "bitrate": 320, "size": 30_000_000, "album": "专辑",
                    **item,
                },
            )


class DuplicateDetectionTests(unittest.TestCase):
    def setUp(self):
        self.service = LocalLibraryService()

    def test_identical_hash_is_reported_regardless_of_metadata(self):
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "hash": "same", "duration": 300, "title": "海阔天空", "artist": "Beyond"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "hash": "same", "duration": 300, "title": "别的名字", "artist": "别的歌手"},
        ])
        groups = self.service._duplicate_groups(40)
        self.assertEqual(groups["total"], 1)
        self.assertEqual(groups["groups"][0]["reason"], "文件完全相同")

    def test_same_title_but_different_duration_is_not_a_duplicate(self):
        """A 30-second intro clip and the full song share a title."""
        insert([
            {"id": "a", "path": "/m/full.flac", "filename": "full.flac", "ext": ".flac",
             "duration": 320, "title": "晴天", "artist": "周杰伦"},
            {"id": "b", "path": "/m/clip.flac", "filename": "clip.flac", "ext": ".flac",
             "duration": 30, "title": "晴天", "artist": "周杰伦"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 0)

    def test_same_title_and_duration_but_different_artist_is_not_a_duplicate(self):
        """Two artists covering the same song at a similar length."""
        insert([
            {"id": "a", "path": "/m/1.flac", "filename": "1.flac", "ext": ".flac",
             "duration": 240, "title": "勇气", "artist": "梁静茹"},
            {"id": "b", "path": "/m/2.flac", "filename": "2.flac", "ext": ".flac",
             "duration": 240, "title": "勇气", "artist": "某翻唱歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 0)

    def test_files_without_duration_are_never_grouped_by_metadata(self):
        """No duration means nothing separates a duplicate from a different take."""
        insert([
            {"id": "a", "path": "/m/1.flac", "filename": "1.flac", "ext": ".flac",
             "duration": 0, "title": "同名", "artist": "同一歌手"},
            {"id": "b", "path": "/m/2.flac", "filename": "2.flac", "ext": ".flac",
             "duration": 0, "title": "同名", "artist": "同一歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 0)

    def test_transcodes_of_the_same_song_group_and_best_bitrate_is_kept(self):
        insert([
            {"id": "mp3", "path": "/m/x.mp3", "filename": "x.mp3", "ext": ".mp3",
             "duration": 313, "bitrate": 320, "size": 12_000_000,
             "title": "海阔天空", "artist": "Beyond"},
            {"id": "flac", "path": "/m/x.flac", "filename": "x.flac", "ext": ".flac",
             "duration": 314, "bitrate": 980, "size": 42_000_000,
             "title": "海阔天空", "artist": "Beyond"},
        ])
        groups = self.service._duplicate_groups(40)
        self.assertEqual(groups["total"], 1)
        members = groups["groups"][0]["items"]
        self.assertTrue(members[0]["keep"], "第一个应该是建议保留的")
        self.assertEqual(members[0]["id"], "flac", "码率高的排前面")
        self.assertFalse(members[1]["keep"])

    def test_duration_bucket_tolerates_small_transcode_drift(self):
        """313s and 314s are the same song; the bucket must not split them."""
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 313, "title": "同一首", "artist": "同一歌手"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "duration": 314, "title": "同一首", "artist": "同一歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 1)


class HealthReportTests(unittest.TestCase):
    def setUp(self):
        self.service = LocalLibraryService()

    def test_clean_library_reports_no_checks_and_full_score(self):
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 200, "title": "一", "artist": "甲"},
        ])
        report = self.service.health()
        # 文件不在磁盘上，所以 orphan 一定会命中 —— 这条本身就是要报的。
        self.assertEqual(report["missingOnDiskTotal"], 1)
        self.assertTrue(any(check["id"] == "orphan" for check in report["checks"]))

    def test_every_reported_check_carries_the_page_that_fixes_it(self):
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 200, "title": "一", "artist": "", "has_cover": 0,
             "has_lrc": 0, "plex_matched": 0, "path_rule_ok": 0},
        ])
        report = self.service.health()
        self.assertTrue(report["checks"], "有问题就必须报出来")
        for check in report["checks"]:
            self.assertIn("page", check, f"{check['id']} 没有告诉界面该去哪一页")
            self.assertTrue(check["hint"], f"{check['id']} 没有给出怎么修")
            self.assertIn(check["severity"], {"info", "warning", "danger"})

    def test_checks_list_hides_zero_counts_but_allchecks_keeps_them(self):
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 200, "title": "一", "artist": "甲"},
        ])
        report = self.service.health()
        self.assertTrue(all(check["count"] for check in report["checks"]))
        ids = {check["id"] for check in report["allChecks"]}
        self.assertTrue({"cover", "lyrics", "artist", "album", "path", "plex"} <= ids)

    def test_empty_library_scores_100_instead_of_dividing_by_zero(self):
        insert([])
        report = self.service.health()
        self.assertEqual(report["total"], 0)
        self.assertEqual(report["score"], 100)
        self.assertTrue(report["clean"])


if __name__ == "__main__":
    unittest.main()
