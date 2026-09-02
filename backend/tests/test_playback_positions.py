"""跨设备续播。

值得测的不是"能存能取"，是**什么位置不该存**。
一个把每首歌都记下来的续播列表毫无用处：秒退的、听完的全在里面，
真正想接着听的那一首被挤到看不见的地方。
"""

import os
import tempfile
import unittest

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="resume-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="resume-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="resume-plex-"))

from app import playback_positions as resume
from app.db import init_db, transaction

init_db()

USER = "test-user"
OTHER = "someone-else"


def ensure_users():
    """playback_positions.user_id 有外键约束，用户必须先存在。

    这个约束是有意的：用户被删掉时他的续播位置应该跟着走
    （ON DELETE CASCADE），留着一堆孤儿记录没有任何意义。

    **只能在 setUp 里调用，不能放在模块顶层。**
    整个测试套件共用一个 DATA_DIR（各文件都用 os.environ.setdefault，
    第一个 import 的那个赢），而 auth.ensure_bootstrap_password() 的
    判据是"users 表为空"。在模块导入时就插入用户，会让 app 启动时
    不再创建 admin，于是 test_commercial_foundation 里所有需要
    登录的用例全部 401。这一条踩过，别再挪上去。
    """
    with transaction() as conn:
        for user_id in (USER, OTHER):
            conn.execute(
                """INSERT OR IGNORE INTO users
                     (id,username,display_name,password_hash,role,enabled,created_at,updated_at)
                   VALUES (?,?,?,'x','listener',1,'','')""",
                (user_id, user_id, user_id),
            )


def clear():
    with transaction() as conn:
        conn.execute("DELETE FROM playback_positions")


class WorthRememberingTests(unittest.TestCase):
    def test_a_track_barely_started_is_not_remembered(self):
        """4 秒就停下的是"划过去了"，不是"被打断了"。"""
        self.assertFalse(resume.should_remember(4, 300))

    def test_a_track_played_to_the_end_is_not_remembered(self):
        self.assertFalse(resume.should_remember(298, 300))

    def test_the_middle_of_a_track_is_remembered(self):
        self.assertTrue(resume.should_remember(200, 300))

    def test_unknown_duration_still_uses_the_lower_bound(self):
        """直播流或者没读到时长的文件，至少还能分辨"刚开始"和"听进去了"。"""
        self.assertFalse(resume.should_remember(5, 0))
        self.assertTrue(resume.should_remember(200, 0))

    def test_a_very_short_track_is_never_remembered(self):
        """30 秒的片段，开头 20 秒和结尾 25 秒重叠，任何位置都不该记。"""
        for position in (0, 10, 20, 25, 29):
            self.assertFalse(
                resume.should_remember(position, 30),
                f"{position}s / 30s 不该被记住",
            )


class StorageTests(unittest.TestCase):
    def setUp(self):
        ensure_users()
        clear()

    def test_saving_then_reading_gives_the_position_back(self):
        resume.save(USER, {"trackKey": "k1", "position": 200, "duration": 300,
                           "title": "海阔天空", "artist": "Beyond", "device": "iPhone"})
        point = resume.get(USER, "k1")
        self.assertEqual(point["position"], 200)
        self.assertEqual(point["device"], "iPhone")
        self.assertAlmostEqual(point["progress"], 0.6667, places=3)

    def test_progress_is_zero_instead_of_dividing_by_zero(self):
        resume.save(USER, {"trackKey": "k1", "position": 200, "duration": 0})
        self.assertEqual(resume.get(USER, "k1")["progress"], 0)

    def test_saving_the_same_track_updates_instead_of_adding_a_row(self):
        for position in (100, 150, 200):
            resume.save(USER, {"trackKey": "k1", "position": position, "duration": 300})
        self.assertEqual(len(resume.recent(USER)), 1)
        self.assertEqual(resume.get(USER, "k1")["position"], 200)

    def test_finishing_a_track_clears_the_position_it_had(self):
        """从 3:20 接着听、一路听完之后，下次不该再问要不要从 3:20 开始。"""
        resume.save(USER, {"trackKey": "k1", "position": 200, "duration": 300})
        self.assertIsNotNone(resume.get(USER, "k1"))
        result = resume.save(USER, {"trackKey": "k1", "position": 299, "duration": 300})
        self.assertFalse(result["stored"])
        self.assertIsNone(resume.get(USER, "k1"), "听完之后旧位置必须被清掉")

    def test_missing_track_key_is_rejected(self):
        with self.assertRaises(ValueError):
            resume.save(USER, {"position": 200, "duration": 300})

    def test_recent_is_newest_first(self):
        for key in ("a", "b", "c"):
            resume.save(USER, {"trackKey": key, "position": 100, "duration": 300})
        self.assertEqual([item["trackKey"] for item in resume.recent(USER)], ["c", "b", "a"])

    def test_old_entries_are_trimmed_so_the_list_stays_usable(self):
        for index in range(resume.MAX_ENTRIES_PER_USER + 15):
            resume.save(USER, {"trackKey": f"k{index}", "position": 100, "duration": 300})
        self.assertEqual(len(resume.recent(USER, limit=999)), resume.MAX_ENTRIES_PER_USER)

    def test_one_users_positions_are_invisible_to_another(self):
        resume.save(USER, {"trackKey": "k1", "position": 200, "duration": 300})
        self.assertIsNone(resume.get(OTHER, "k1"))
        self.assertEqual(resume.recent(OTHER), [])

    def test_broken_track_snapshot_does_not_break_reading(self):
        """历史数据里可能有非 JSON 的 track 字段，不能让整页打不开。"""
        resume.save(USER, {"trackKey": "k1", "position": 200, "duration": 300})
        with transaction() as conn:
            conn.execute(
                "UPDATE playback_positions SET track='不是 JSON' WHERE track_key='k1'"
            )
        self.assertEqual(resume.get(USER, "k1")["track"], {})


if __name__ == "__main__":
    unittest.main()
