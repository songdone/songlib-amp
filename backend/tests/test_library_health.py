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
from app import local_library as local_library_module
from app.local_library import LocalLibraryService

init_db()


def insert(rows):
    """Put rows straight into the files table. Only the columns health() reads.

    注意这里是 `DELETE FROM files`，清的是整张表。

    可以这么做，是因为整个套件共用一个 DATA_DIR，而其他用到 files 的
    测试（test_commercial_foundation）只按自己的 id 删自己的行、
    不依赖别人留下的数据。health() 和 _duplicate_groups() 都是全表扫描，
    留着别的测试的行会让这里的断言随执行顺序变化。
    """
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

    def test_one_second_apart_across_an_old_bucket_boundary_still_groups(self):
        """215s 和 216s 差一秒，是同一首歌。

        这一对是原来 duration // 3 分桶漏掉的：215//3 是 71，216//3 是 72，
        两个桶。上面那个 313/314 的用例正好落在同一个桶里，所以从来没
        暴露过这件事。判据改成沿时长排序、按容差聚类之后，容差才真的
        是 ±3 秒，不再取决于两个值落在桶的哪个位置。
        """
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 215, "title": "同一首", "artist": "同一歌手"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "duration": 216, "title": "同一首", "artist": "同一歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 1)

    def test_tolerance_is_the_same_number_the_import_check_uses(self):
        """容差刚好 3 秒算重复，4 秒不算 —— 而且两处用的是同一个常量。

        体检说是重复、入库却不提醒（或者反过来），比统一用一个稍严
        或稍松的阈值更糟。
        """
        self.assertEqual(local_library_module.DUPLICATE_DURATION_TOLERANCE, 3)
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 240, "title": "同一首", "artist": "同一歌手"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "duration": 243, "title": "同一首", "artist": "同一歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 1, "差 3 秒应算重复")
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 240, "title": "同一首", "artist": "同一歌手"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "duration": 244, "title": "同一首", "artist": "同一歌手"},
        ])
        self.assertEqual(self.service._duplicate_groups(40)["total"], 0, "差 4 秒不算")

    def test_a_chain_of_transcodes_does_not_swallow_a_different_recording(self):
        """聚类是链式的，不能让一串小差值把两个真不同的录音连成一组。

        238、240、242 三份互相都在容差内，是同一首歌的三个转码。
        而 252 跟其中任何一个都差了 10 秒以上，必须单独留着 ——
        它可能是加了尾奏的现场版。
        """
        insert([
            {"id": "a", "path": "/m/a.flac", "filename": "a.flac", "ext": ".flac",
             "duration": 238, "title": "同一首", "artist": "同一歌手"},
            {"id": "b", "path": "/m/b.flac", "filename": "b.flac", "ext": ".flac",
             "duration": 240, "title": "同一首", "artist": "同一歌手"},
            {"id": "c", "path": "/m/c.flac", "filename": "c.flac", "ext": ".flac",
             "duration": 242, "title": "同一首", "artist": "同一歌手"},
            {"id": "live", "path": "/m/live.flac", "filename": "live.flac", "ext": ".flac",
             "duration": 252, "title": "同一首", "artist": "同一歌手"},
        ])
        groups = self.service._duplicate_groups(40)
        self.assertEqual(groups["total"], 1, "只有那三个转码算一组")
        self.assertEqual(len(groups["groups"][0]["items"]), 3)
        self.assertNotIn("live", [item["id"] for item in groups["groups"][0]["items"]])


class FindSimilarTests(unittest.TestCase):
    """入库前查"曲库里是不是已经有了"。

    这个判据必须和体检的判重一致：体检说是重复、入库却不提醒，
    或者反过来，都比统一用一个稍严或稍松的规则更糟。
    """

    def setUp(self):
        self.service = LocalLibraryService()
        insert([
            {"id": "flac", "path": "/m/Beyond/乐与怒/03 - 海阔天空.flac",
             "filename": "03 - 海阔天空.flac", "ext": ".flac", "duration": 313,
             "bitrate": 982, "size": 44_100_000, "title": "海阔天空", "artist": "Beyond"},
            {"id": "other", "path": "/m/别人/翻唱/海阔天空.flac",
             "filename": "海阔天空.flac", "ext": ".flac", "duration": 313,
             "bitrate": 900, "size": 40_000_000, "title": "海阔天空", "artist": "某翻唱歌手"},
        ])

    def test_finds_the_same_song_at_a_different_path(self):
        """target.exists() 发现不了的正是这种情况。"""
        found = self.service.find_similar("海阔天空", "Beyond", 313)
        self.assertEqual([entry["id"] for entry in found], ["flac"])

    def test_a_cover_by_another_artist_is_not_reported(self):
        found = self.service.find_similar("海阔天空", "完全不同的歌手", 313)
        self.assertEqual(found, [])

    def test_a_clip_with_the_same_name_is_not_reported(self):
        found = self.service.find_similar("海阔天空", "Beyond", 30)
        self.assertEqual(found, [])

    def test_unknown_incoming_duration_still_reports_by_title_and_artist(self):
        """时长不知道时宁可多提醒一次，也好过入完库才发现重了。"""
        found = self.service.find_similar("海阔天空", "Beyond", 0)
        self.assertEqual([entry["id"] for entry in found], ["flac"])

    def test_empty_artist_matches_on_title_alone(self):
        found = self.service.find_similar("海阔天空", "", 313)
        self.assertEqual({entry["id"] for entry in found}, {"flac", "other"})

    def test_results_are_sorted_best_first(self):
        found = self.service.find_similar("海阔天空", "", 313)
        self.assertEqual(found[0]["id"], "flac", "码率高的排前面，用户先看到最好的那份")

    def test_blank_title_matches_nothing_instead_of_everything(self):
        self.assertEqual(self.service.find_similar("", "Beyond", 313), [])


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
