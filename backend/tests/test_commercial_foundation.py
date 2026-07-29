import os
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="songlib-commercial-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="songlib-commercial-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="songlib-commercial-plex-"))
os.environ.setdefault("WORKER_MODE", "web")

from fastapi.testclient import TestClient

from app import auth
from app.config import settings
from app.db import init_db, row, rows, set_kv, transaction
from app.download_inbox import _repair_mojibake
from app.jobs import manager
from app.main import app, plex
from app.fnos_music import FnosMusicClient
from app.playlist_migration import detect_share_link, strict_candidate
from app.playlists import create_playlist, import_m3u
from app.recommendations import list_recommendations, refresh


class CommercialFoundationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        auth.ensure_bootstrap_password()

    def setUp(self):
        with transaction() as conn:
            conn.execute("DELETE FROM playlist_items")
            conn.execute("DELETE FROM playlists")
            conn.execute("DELETE FROM recommendation_candidates")
            conn.execute("DELETE FROM listening_events")
            conn.execute("DELETE FROM recommendation_profiles")
            conn.execute("DELETE FROM users WHERE username='listener-contract'")

    def test_versioned_migration_created_domain_tables(self):
        migration = row("SELECT version,name FROM schema_migrations WHERE version=1")
        self.assertEqual(migration["name"], "commercial_foundation")
        tables = {item["name"] for item in rows("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"playlists", "listening_events", "recommendation_candidates", "audit_events"} <= tables)

    def test_job_idempotency_returns_existing_job(self):
        key = "test-idempotency-commercial"
        with transaction() as conn:
            conn.execute("DELETE FROM jobs WHERE idempotency_key=?", (key,))
        first = manager.create("local_scan", "扫描", {"idempotencyKey": key})
        second = manager.create("local_scan", "扫描", {"idempotencyKey": key})
        self.assertEqual(first["id"], second["id"])

    def test_m3u_import_keeps_order_and_reports_unmatched(self):
        result = import_m3u(
            "admin",
            "导入测试",
            "#EXTM3U\n#EXTINF:180,歌手甲 - 歌曲甲\n/old/歌手甲/歌曲甲.flac\n"
            "#EXTINF:200,歌手乙 - 歌曲乙\n/old/歌手乙/歌曲乙.flac\n",
            [{"source": "/old", "target": "/music"}],
        )
        self.assertEqual(result["playlist"]["itemCount"], 2)
        self.assertEqual([item["position"] for item in result["playlist"]["items"]], [0, 1])
        self.assertEqual(len(result["unmatched"]), 2)
        self.assertTrue(result["playlist"]["items"][0]["path"].startswith("/music/"))

    def test_plex_playlist_reference_stays_linked(self):
        result = create_playlist(
            "admin",
            "Plex playback",
            items=[
                {
                    "externalRef": "plex:7842",
                    "title": "When We Were Young",
                    "artist": "Adele",
                    "album": "25",
                    "duration": 290,
                }
            ],
        )
        self.assertEqual(result["items"][0]["external_ref"], "plex:7842")
        self.assertEqual(result["items"][0]["match_status"], "linked")

    def test_external_recommendations_filter_versions(self):
        result = refresh(
            "admin",
            [
                {"title": "一首新歌", "artist": "新歌手", "durationMs": 210000, "externalRef": "provider:1"},
                {"title": "一首新歌 Live", "artist": "新歌手", "durationMs": 210000, "externalRef": "provider:2"},
            ],
            0.5,
        )
        external = [item for item in result["items"] if not item["inLibrary"]]
        self.assertEqual([item["title"] for item in external], ["一首新歌"])
        self.assertIn("库外探索", external[0]["reasons"])

    def test_session_requires_csrf_for_changes(self):
        with TestClient(app) as client:
            login = client.post("/api/auth/login", json={"username": "admin", "password": "test-password-123"})
            self.assertEqual(login.status_code, 200)
            denied = client.patch("/api/settings", json={"values": {"theme": "dark"}})
            self.assertEqual(denied.status_code, 403)
            token = client.cookies.get("songlib_csrf")
            accepted = client.patch(
                "/api/settings",
                json={"values": {"theme": "dark"}},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(accepted.status_code, 200)

    def test_listener_role_is_limited_to_listening_flows(self):
        auth.create_user(
            "listener-contract",
            "listener-password-123",
            "Listener",
            role="listener",
            permissions=["listen"],
        )
        with TestClient(app) as client:
            login = client.post(
                "/api/auth/login",
                json={
                    "username": "listener-contract",
                    "password": "listener-password-123",
                },
            )
            self.assertEqual(login.status_code, 200)
            self.assertEqual(client.get("/api/library/tracks").status_code, 200)
            token = client.cookies.get("songlib_csrf")
            blocked = client.post(
                "/api/plex/sync",
                json={},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(blocked.status_code, 403)
            allowed = client.post(
                "/api/playlists",
                json={"name": "Listener playlist", "items": []},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(allowed.status_code, 200)

    def test_backup_file_is_owner_only(self):
        with TestClient(app) as client:
            login = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "test-password-123"},
            )
            self.assertEqual(login.status_code, 200)
            token = client.cookies.get("songlib_csrf")
            created = client.post(
                "/api/backups",
                json={},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(created.status_code, 200)
            path = settings.data_dir / "backups" / created.json()["item"]["name"]
            if os.name == "posix":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            else:
                self.assertTrue(path.is_file())
            path.unlink()

    def test_health_contract(self):
        with TestClient(app) as client:
            response = client.get("/api/health/ready")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ready")
            self.assertIn("database", payload["checks"])
            self.assertIn("storage", payload["checks"])

    def test_fnos_music_uses_the_public_music_api_prefix(self):
        self.assertEqual(
            FnosMusicClient._api_base("http://nas.example:5666"),
            "http://nas.example:5666/music/api/v1",
        )
        self.assertEqual(
            FnosMusicClient._api_base("http://nas.example:5666/music/"),
            "http://nas.example:5666/music/api/v1",
        )

    def test_artist_and_album_detail_contracts(self):
        artist = {
            "ratingKey": "artist-1",
            "type": "artist",
            "title": "周杰伦",
            "summary": "艺人简介",
        }
        album = {
            "ratingKey": "album-1",
            "type": "album",
            "title": "叶惠美",
            "parentRatingKey": "artist-1",
            "parentTitle": "周杰伦",
        }
        track = {
            "ratingKey": "track-1",
            "type": "track",
            "title": "晴天",
            "duration": "269000",
            "index": "3",
            "viewCount": "12",
        }
        with TestClient(app) as client:
            login = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "test-password-123"},
            )
            self.assertEqual(login.status_code, 200)
            with (
                patch.object(
                    plex,
                    "metadata",
                    side_effect=lambda key: artist if key == "artist-1" else album,
                ),
                patch.object(
                    plex,
                    "children",
                    side_effect=lambda key: [album] if key == "artist-1" else [track],
                ),
                patch.object(plex, "all_leaves", return_value=[track]),
            ):
                artist_response = client.get("/api/library/artists/artist-1")
                album_response = client.get("/api/library/albums/album-1")
        self.assertEqual(artist_response.status_code, 200)
        self.assertEqual(artist_response.json()["albumCount"], 1)
        self.assertEqual(album_response.status_code, 200)
        self.assertEqual(album_response.json()["trackCount"], 1)

    def test_health_uses_saved_plex_settings(self):
        set_kv(
            "plex_settings",
            {
                "enabled": True,
                "serverUrl": "http://plex.test",
                "token": "test-token",
            },
        )
        try:
            with patch.object(plex, "xml", return_value=None), TestClient(app) as client:
                response = client.get("/api/health")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["checks"]["plex"]["status"], "connected")
        finally:
            set_kv("plex_settings", {})

    def test_download_staging_is_outside_music_library(self):
        self.assertEqual(settings.incoming_dir.parent, settings.download_mount)
        self.assertNotEqual(settings.incoming_dir.parent, settings.music_root)
        self.assertEqual(settings.download_trash_dir.parent, settings.download_mount)

    def test_share_link_detection_supports_netease_and_qq(self):
        with patch(
            "app.playlist_migration._resolve_share_url",
            side_effect=lambda value: value,
        ):
            netease = detect_share_link("https://music.163.com/#/playlist?id=123456")
            qq = detect_share_link("https://y.qq.com/n/ryqq/playlist/987654")
        self.assertEqual((netease["platform"], netease["playlistId"]), ("netease", "123456"))
        self.assertEqual((qq["platform"], qq["playlistId"]), ("qq", "987654"))

    def test_direct_share_link_does_not_wait_for_redirect_resolution(self):
        with (
            patch("app.playlist_migration.validate_public_url"),
            patch("app.playlist_migration.httpx.Client") as client,
        ):
            result = detect_share_link("https://music.163.com/#/playlist?id=123456")
        client.assert_not_called()
        self.assertEqual(result["playlistId"], "123456")

    def test_download_inbox_repairs_mojibake_without_simplifying_chinese(self):
        self.assertEqual(_repair_mojibake("æ­Œæ›²"), "歌曲")
        self.assertEqual(_repair_mojibake("我們的歌"), "我們的歌")

    def test_playlist_download_candidate_requires_title_artist_and_duration(self):
        wanted = {"title": "晴天", "artist": "周杰伦", "duration": 269}
        candidates = [
            {"title": "晴天 Live", "artist": "周杰伦", "duration": 269},
            {"title": "晴天", "artist": "翻唱歌手", "duration": 269},
            {"title": "晴天", "artist": "周杰伦", "duration": 310},
        ]
        self.assertIsNone(strict_candidate(wanted, candidates))
        accepted = strict_candidate(
            wanted,
            candidates + [{"title": "晴天", "artist": "周杰伦", "duration": 271}],
        )
        self.assertEqual(accepted["duration"], 271)


if __name__ == "__main__":
    unittest.main()
