import os
import tempfile
import unittest

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="songlib-commercial-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="songlib-commercial-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="songlib-commercial-plex-"))
os.environ.setdefault("WORKER_MODE", "web")

from fastapi.testclient import TestClient

from app import auth
from app.db import init_db, row, rows, transaction
from app.jobs import manager
from app.main import app
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

    def test_health_contract(self):
        with TestClient(app) as client:
            response = client.get("/api/health/ready")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ready")
            self.assertIn("database", payload["checks"])
            self.assertIn("storage", payload["checks"])


if __name__ == "__main__":
    unittest.main()
