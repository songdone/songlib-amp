import os
import secrets
import tempfile
import unittest
import wave
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock, patch

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="songlib-commercial-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="songlib-commercial-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="songlib-commercial-plex-"))
os.environ.setdefault("WORKER_MODE", "web")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from mutagen import File as MutagenFile

from app import auth
from app.config import settings
from app.db import init_db, row, rows, set_kv, transaction
from app.download_inbox import _repair_mojibake
from app.jobs import manager
from app.local_library import local_library
from app.main import app, fnos_music, plex, plex_lyrics
from app.fnos_music import FnosMusicClient
from app.plex import dashboard_stats
from app.playlist_migration import detect_share_link, strict_candidate
from app.playlists import create_playlist, import_m3u
from app.recommendations import list_recommendations, refresh
from app.scraper import build_diff_preview
from app.security import rate_limiter


class CommercialFoundationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        auth.ensure_bootstrap_password()

    def setUp(self):
        # Login throttling is process-global in production. Tests create fresh
        # clients per case, so reset the in-memory window to keep cases isolated.
        with rate_limiter._lock:
            rate_limiter._events.clear()
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

    def test_wav_tags_are_written_to_real_id3_frames_and_can_be_rolled_back(self):
        Path(settings.music_root).mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tag-write-", dir=settings.music_root) as directory:
            path = Path(directory) / "01 - 原始标题.wav"
            with wave.open(str(path), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8_000)
                audio.writeframes(bytes(16_000))

            local_library.scan({}, lambda *_args: None)
            item = next(
                value
                for value in local_library.list("原始标题", "", 20, 0)["items"]
                if value["path"] == str(path.resolve())
            )
            updated = local_library.update_tags(
                item["id"],
                {"title": "写入后的标题", "artist": "测试歌手", "album": "测试专辑"},
            )

            self.assertEqual(updated["title"], "写入后的标题")
            written = MutagenFile(path, easy=False)
            self.assertEqual(written.tags.get("TIT2").text[0], "写入后的标题")
            self.assertEqual(written.tags.get("TPE1").text[0], "测试歌手")

            operation = row(
                "SELECT id FROM operation_logs WHERE action='tag_write' AND target_id=? ORDER BY created_at DESC LIMIT 1",
                (item["id"],),
            )
            local_library.rollback(operation["id"])
            rolled_back = MutagenFile(path, easy=False)
            self.assertIsNone(rolled_back.tags.get("TIT2"))
            self.assertIsNone(rolled_back.tags.get("TPE1"))
            with transaction() as conn:
                conn.execute("DELETE FROM operation_logs WHERE target_id=?", (item["id"],))
                conn.execute("DELETE FROM files WHERE id=?", (item["id"],))

    def test_plex_metadata_preview_keeps_every_user_facing_asset(self):
        artist = {"ratingKey": "artist-1", "sectionKey": "1", "title": "测试歌手"}
        album = {
            "ratingKey": "album-1",
            "sectionKey": "1",
            "title": "测试专辑",
            "parentTitle": "测试歌手",
        }
        with (
            patch("app.scraper.plex.artists", return_value=[artist]),
            patch("app.scraper.plex.albums", return_value=[album]),
            patch("app.scraper.plex.first_track", side_effect=RuntimeError("no local file")),
        ):
            plan = build_diff_preview("scrape_plex_metadata", "all", "missing", 20)

        fields = {item["field"] for item in plan["items"]}
        self.assertTrue(
            {"歌手海报", "歌手背景", "中文简介", "专辑封面", "专辑中文简介"} <= fields
        )
        self.assertEqual(plan["summary"]["create"], 5)

    def test_download_is_queued_without_a_preflight_permission_gate(self):
        item = {
            "trackId": "track-1",
            "platform": "tx",
            "title": "晴天",
            "artist": "周杰伦",
            "musicInfo": {"id": "track-1", "source": "tx"},
        }
        with TestClient(app) as client:
            client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "test-password-123"},
            )
            token = client.cookies.get("songlib_csrf")
            with patch.object(
                manager,
                "create",
                return_value={"id": 88, "kind": "download", "status": "queued"},
            ) as create:
                response = client.post(
                    "/api/downloads",
                    json={"sourceId": "recognized-source", "quality": "320k", "item": item},
                    headers={"X-CSRF-Token": token},
                )
        self.assertEqual(response.status_code, 200)
        payload = create.call_args.args[2]
        self.assertNotIn("preflight", payload)
        self.assertEqual(payload["sourceId"], "recognized-source")

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
            cast = client.post(
                "/api/airplay/cast",
                json={},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(cast.status_code, 200)
            cast_payload = cast.json()
            self.assertEqual(cast_payload["audioMode"], "dual-clock-silent-aac")
            updated = client.patch(
                f"/api/airplay/cast/{cast_payload['sessionId']}",
                json={
                    "trackId": "listener:test-track",
                    "title": "权限测试",
                    "lyrics": "[00:01.00]歌词",
                    "position": 3,
                    "duration": 120,
                    "playing": True,
                },
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["streamUrl"], cast_payload["streamUrl"])

    def test_airplay_lyrics_and_clock_survive_missing_plex_artwork(self):
        with TestClient(app) as client, patch.object(
            plex,
            "playback",
            side_effect=RuntimeError("Plex artwork temporarily unavailable"),
        ):
            login = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "test-password-123"},
            )
            self.assertEqual(login.status_code, 200)
            token = client.cookies.get("songlib_csrf")
            headers = {"X-CSRF-Token": token}
            created = client.post("/api/airplay/cast", json={}, headers=headers)
            self.assertEqual(created.status_code, 200)
            session_id = created.json()["sessionId"]
            updated = client.patch(
                f"/api/airplay/cast/{session_id}",
                json={
                    "trackId": "plex_session:missing-artwork",
                    "title": "仍应显示的歌曲",
                    "artist": "测试歌手",
                    "lyrics": "[00:01.00]歌词不能被封面故障阻断",
                    "position": 3,
                    "duration": 120,
                    "playing": True,
                    "sourceType": "plex_session",
                    "plexRatingKey": "missing-artwork",
                    "coverKey": "/api/plex/image?path=missing",
                },
                headers=headers,
            )
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["trackId"], "plex_session:missing-artwork")
            heartbeat = client.patch(
                f"/api/airplay/cast/{session_id}/clock",
                json={
                    "position": 4,
                    "duration": 120,
                    "playing": True,
                    "lyricsOffsetMs": 250,
                    "transportLatencyMs": 1500,
                },
                headers=headers,
            )
            self.assertEqual(heartbeat.status_code, 200)
            self.assertEqual(heartbeat.json()["lyricsOffsetMs"], 250)
            client.delete(f"/api/airplay/cast/{session_id}", headers=headers)

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

    def test_airplay_bearer_stream_allows_cross_origin_player_requests(self):
        with TestClient(app) as client:
            response = client.get(
                "/api/airplay/stream/expired-token/master.m3u8",
                headers={"Origin": "https://apple-tv.invalid"},
            )
        self.assertEqual(response.status_code, 404)

    def test_fnos_music_uses_the_public_music_api_prefix(self):
        self.assertEqual(
            FnosMusicClient._api_base("http://nas.example:5666"),
            "http://nas.example:5666/music/api/v1",
        )
        self.assertEqual(
            FnosMusicClient._api_base("http://nas.example:5666/music/"),
            "http://nas.example:5666/music/api/v1",
        )

    def test_fnos_playlist_listing_is_normalized(self):
        client = FnosMusicClient()
        with patch.object(
            client,
            "request",
            return_value={
                "list": [
                    {"guid": "fnos-1", "name": "通勤", "trackCount": "12"},
                    {"guid": "fnos-2", "name": "夜晚", "songCount": 8},
                ]
            },
        ):
            self.assertEqual(
                client.playlists(),
                [
                    {
                        "id": "fnos-1",
                        "name": "通勤",
                        "itemCount": 12,
                        "updatedAt": None,
                    },
                    {
                        "id": "fnos-2",
                        "name": "夜晚",
                        "itemCount": 8,
                        "updatedAt": None,
                    },
                ],
            )

    def test_connected_plex_playlists_are_exposed_to_the_playlist_page(self):
        with (
            patch.object(
                plex,
                "saved_settings",
                return_value={"enabled": True, "serverUrl": "http://plex.test"},
            ),
            patch.object(
                plex,
                "playlists",
                return_value=[
                    {
                        "ratingKey": "playlist-1",
                        "title": "常听精选",
                        "leafCount": "23",
                        "duration": "1000",
                        "composite": "/playlists/playlist-1/composite",
                    }
                ],
            ),
            patch.object(
                type(fnos_music),
                "configured",
                new_callable=PropertyMock,
                return_value=False,
            ),
        ):
            with TestClient(app) as client:
                login = client.post(
                    "/api/auth/login",
                    json={
                        "username": "admin",
                        "password": "test-password-123",
                    },
                )
                self.assertEqual(login.status_code, 200)
                response = client.get("/api/playlists/services")
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertTrue(payload["plex"]["configured"])
                self.assertEqual(payload["plex"]["items"][0]["itemCount"], 23)
                self.assertFalse(payload["fnos"]["configured"])

    def test_connected_plex_playlist_returns_ordered_playable_tracks(self):
        with (
            patch.object(
                plex,
                "saved_settings",
                return_value={"enabled": True, "serverUrl": "http://plex.test"},
            ),
            patch.object(
                plex,
                "playlist_items",
                return_value=[
                    {
                        "ratingKey": "track-7",
                        "title": "晴天",
                        "grandparentTitle": "周杰伦",
                        "parentTitle": "叶惠美",
                        "duration": "269000",
                        "thumb": "/library/metadata/track-7/thumb",
                    },
                    {
                        "ratingKey": "track-8",
                        "title": "夜曲",
                        "grandparentTitle": "周杰伦",
                        "parentTitle": "十一月的萧邦",
                        "duration": "226000",
                    },
                ],
            ),
        ):
            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={
                        "username": "admin",
                        "password": "test-password-123",
                    },
                )
                response = client.get(
                    "/api/playlists/services/plex/playlist-1"
                )
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload["itemCount"], 2)
                self.assertEqual(
                    [item["ratingKey"] for item in payload["items"]],
                    ["track-7", "track-8"],
                )
                self.assertEqual(payload["items"][0]["source"], "plex_item")
                self.assertEqual(payload["items"][0]["artist"], "周杰伦")

    def test_plex_player_fetches_verified_lyrics_when_sidecar_is_missing(self):
        with (
            patch.object(
                plex,
                "playback",
                return_value={
                    "ratingKey": "track-7",
                    "title": "晴天",
                    "artist": "周杰伦",
                    "album": "叶惠美",
                    "duration": 269000,
                    "file": "/unmapped/晴天.flac",
                },
            ),
            patch(
                "app.main.find_lyrics",
                return_value=("[00:01.00]故事的小黄花\n[00:04.00]从出生那年就飘着\n[00:08.00]童年的荡秋千\n", "qq"),
            ),
        ):
            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={
                        "username": "admin",
                        "password": "test-password-123",
                    },
                )
                response = client.get("/api/player/plex/track-7/lyrics")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["source"], "qq")
                self.assertIn("[00:01.00]", response.json()["lyrics"])

    def test_plex_player_prefers_the_server_lyric_stream(self):
        server_lyrics = "[00:01.00]Plex 字幕流歌词\n[00:05.00]第二句"
        with (
            patch.object(
                plex,
                "playback",
                return_value={
                    "ratingKey": "track-stream",
                    "title": "带歌词流的歌曲",
                    "artist": "测试歌手",
                    "album": "测试专辑",
                    "duration": 200000,
                    "file": "/unmapped/song.flac",
                    "lyricStreamKey": "/library/streams/lyric-1",
                    "lyricFormat": "lrc",
                },
            ),
            patch.object(
                plex,
                "lyrics",
                return_value={
                    "lyrics": server_lyrics,
                    "format": "lrc",
                    "source": "plex",
                },
            ) as plex_lyrics_fetch,
            patch("app.main.find_lyrics") as provider,
        ):
            response = plex_lyrics("track-stream")
        self.assertEqual(response["source"], "plex")
        self.assertEqual(response["lyrics"], server_lyrics)
        plex_lyrics_fetch.assert_called_once_with(
            "track-stream",
            stream_key="/library/streams/lyric-1",
            stream_format="lrc",
        )
        provider.assert_not_called()

    def test_plex_lyric_stream_uses_shared_encoding_detection(self):
        response = MagicMock()
        expected = "[00:01.00]Plex 字幕流歌词"
        response.content = expected.encode("utf-16")
        with patch.object(plex, "request", return_value=response) as request:
            result = plex.lyrics(
                "track-encoded",
                stream_key="/library/streams/lyric-encoded",
                stream_format="lrc",
            )
        self.assertEqual(result["lyrics"], expected)
        self.assertEqual(result["source"], "plex")
        request.assert_called_once_with(
            "GET",
            "/library/streams/lyric-encoded",
            timeout=8,
        )

    def test_dashboard_prefers_plex_backgrounds_for_artists_with_more_tracks(self):
        music_root = Path(settings.music_root)
        for name in ("Background Priority A", "Background Priority B"):
            artist_dir = music_root / name
            artist_dir.mkdir(parents=True, exist_ok=True)
            (artist_dir / "artist-background.jpg").write_bytes(b"image")
        artists = [
            {
                "ratingKey": "artist-a",
                "title": "Background Priority A",
                "leafCount": "12",
                "art": "/plex/a",
            },
            {
                "ratingKey": "artist-b",
                "title": "Background Priority B",
                "leafCount": "3",
                "art": "/plex/b",
            },
        ]
        tracks = [
            {
                "ratingKey": f"track-{index}",
                "grandparentRatingKey": "artist-a",
                "grandparentTitle": "Background Priority A",
            }
            for index in range(12)
        ]
        tracks.extend(
            [
                {
                    "ratingKey": f"track-b-{index}",
                    "grandparentRatingKey": "artist-b",
                    "grandparentTitle": "Background Priority B",
                }
                for index in range(3)
            ]
        )
        with (
            patch.object(plex, "artists", return_value=artists),
            patch.object(plex, "albums", return_value=[]),
            patch.object(plex, "tracks", return_value=tracks),
        ):
            result = dashboard_stats()
        self.assertEqual(
            [item["title"] for item in result["heroImages"][:2]],
            ["Background Priority A", "Background Priority B"],
        )
        self.assertEqual(result["heroImages"][0]["type"], "plex_artist_background")
        self.assertEqual(result["heroImages"][0]["trackCount"], 12)

    def test_artist_and_album_detail_contracts(self):
        artist = {
            "ratingKey": "artist-1",
            "type": "artist",
            "title": "周杰伦",
            "summary": "艺人简介",
            "art": "/library/metadata/other-artist/art/999",
        }
        album = {
            "ratingKey": "album-1",
            "type": "album",
            "title": "叶惠美",
            "parentRatingKey": "artist-1",
            "parentTitle": "周杰伦",
            "art": "/library/metadata/artist-1/art/123",
        }
        track = {
            "ratingKey": "track-1",
            "type": "track",
            "title": "晴天",
            "duration": "269000",
            "index": "3",
            "viewCount": "12",
            "grandparentRatingKey": "artist-1",
            "grandparentTitle": "周杰伦",
            "art": "/library/metadata/artist-1/art/123",
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
        self.assertIn("artist-1", artist_response.json()["artist"]["backgroundUrl"])
        self.assertNotIn("other-artist", artist_response.json()["artist"]["backgroundUrl"])
        self.assertEqual(album_response.status_code, 200)
        self.assertEqual(album_response.json()["trackCount"], 1)
        self.assertIn("artist-1", album_response.json()["artist"]["backgroundUrl"])

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


class PasswordLengthRuleTests(unittest.TestCase):
    """密码最短长度只能有一个数。

    原来有两个：初始化向导 12 位、后台建用户和改密码 10 位 —— 第一次
    设密码反而比之后改密码更严。这条用例把"只有一个数"钉住。
    """

    def test_setup_and_user_creation_share_one_minimum(self):
        from app import auth

        self.assertEqual(auth.MIN_PASSWORD_LENGTH, 10)
        short = "a" * (auth.MIN_PASSWORD_LENGTH - 1)
        just_enough = "a" * auth.MIN_PASSWORD_LENGTH

        # 向导和建用户必须在同一个长度上拒绝、在同一个长度上放行。
        for label, call in (
            ("初始化向导", lambda pw: auth.complete_setup("someone", pw)),
            ("后台建用户", lambda pw: auth.create_user("someone-else", pw)),
        ):
            with self.subTest(label):
                with self.assertRaises(HTTPException) as caught:
                    call(short)
                self.assertEqual(caught.exception.status_code, 400)
                self.assertIn(str(auth.MIN_PASSWORD_LENGTH), caught.exception.detail)

        # 刚够长度的那一个必须能过。complete_setup 只在没有任何用户时可用，
        # 这个套件里已经有 admin 了，所以这里验的是 create_user。
        # 用户名必须每次不同：这个套件在共享的 DATA_DIR 上跑，写死名字的话
        # 第二次运行会撞上上一次留下的用户而失败 —— 一条用例只有能重复跑
        # 才算数。
        name = f"len-boundary-{secrets.token_hex(4)}"
        created = auth.create_user(name, just_enough)
        self.assertEqual(created["username"], name)


class ReverseProxyOriginTests(unittest.TestCase):
    """HTTPS 反代后面的同源请求不能被自己拦掉。

    线上真炸过一次：应用在反代后面，uvicorn 看到的 scheme 是内网 http，
    浏览器发的 Origin 是 https://<域名>，预期来源算成 http://<域名>，
    于是自己的静态资源被自己 403，整站白屏。
    """

    @staticmethod
    def _request(scheme: str, host: str):
        from starlette.requests import Request

        return Request(
            {
                "type": "http",
                "method": "GET",
                "scheme": scheme,
                "path": "/assets/index.js",
                "query_string": b"",
                "headers": [(b"host", host.encode())],
            }
        )

    def test_https_origin_passes_when_proxy_terminated_tls(self):
        from app.security import SecurityMiddleware

        allowed = SecurityMiddleware._origin_allowed(
            self._request("http", "sla.playsong.cn"), "https://sla.playsong.cn"
        )
        self.assertTrue(allowed, "反代把 TLS 卸载掉之后，同域的 https 来源必须放过")

    def test_same_scheme_origin_still_passes(self):
        from app.security import SecurityMiddleware

        self.assertTrue(
            SecurityMiddleware._origin_allowed(
                self._request("http", "192.168.31.28:32783"),
                "http://192.168.31.28:32783",
            )
        )

    def test_a_different_host_is_still_rejected(self):
        """放宽的只有 scheme，host 仍然必须完全一致。"""
        from app.security import SecurityMiddleware

        for hostile in (
            "https://evil.example.com",
            "https://sla.playsong.cn.evil.example.com",
            "https://sla.playsong.cn:8443",
        ):
            with self.subTest(hostile):
                self.assertFalse(
                    SecurityMiddleware._origin_allowed(
                        self._request("http", "sla.playsong.cn"), hostile
                    ),
                    f"{hostile} 不该被当成同源",
                )


class PlexStreamFallbackTests(unittest.TestCase):
    """转码那条路挂了，播放不能跟着挂 —— 线上 1.1.9 就是这么坏掉的。

    Plex 对 `protocol=hls&maxAudioBitrate=320` 回 400，我们原样包成 502
    丢给 <audio>，播放器直接死。原始音质是直读文件，一直是好的。
    """

    @classmethod
    def setUpClass(cls):
        init_db()
        auth.ensure_bootstrap_password()

    def setUp(self):
        with rate_limiter._lock:
            rate_limiter._events.clear()

    @staticmethod
    def _login(client):
        client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "test-password-123"},
        )

    @staticmethod
    def _playback(bitrate="320k"):
        return {
            "streamUrl": "http://plex.test/music/:/transcode/universal/start.mp3?session=sess-1",
            "originalStreamUrl": "http://plex.test/library/parts/1/file.flac?X-Plex-Token=t",
            "transcodeSession": "sess-1",
            # 4 分 02 秒。320kbps 下 CBR 字节数 = 242 * 320 * 125 = 9,680,000
            "duration": 242000,
            "mode": "transcode" if bitrate != "original" else "original",
            "bitrate": bitrate,
        }

    def _upstream(self, *, transcode_ok: bool):
        """伪造 httpx.Client：转码地址按参数决定成败，原始地址总是成功。"""
        sent = []

        def send(request, **kwargs):
            sent.append(str(request.url))
            response = MagicMock()
            if "transcode" in str(request.url) and not transcode_ok:
                response.raise_for_status.side_effect = RuntimeError(
                    "Client error '400 Bad Request'"
                )
                return response
            response.raise_for_status.return_value = None
            response.status_code = 200
            response.headers = {"content-type": "audio/flac", "accept-ranges": "bytes"}
            response.iter_bytes.return_value = iter([b"\x00" * 16])
            return response

        client = MagicMock()
        client.build_request.side_effect = lambda method, url, headers=None: MagicMock(url=url)
        client.send.side_effect = send
        return client, sent

    def test_a_failing_transcode_falls_back_to_the_original_stream(self):
        client_mock, sent = self._upstream(transcode_ok=False)
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("x-songlib-stream-mode"), "original")
        self.assertEqual(response.headers.get("x-songlib-stream-fallback"), "1")
        self.assertEqual(len(sent), 2)
        self.assertIn("transcode", sent[0])
        self.assertNotIn("transcode", sent[1])

    def test_a_working_transcode_is_not_downgraded(self):
        client_mock, sent = self._upstream(transcode_ok=True)
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("x-songlib-stream-mode"), "transcode")
        self.assertIsNone(response.headers.get("x-songlib-stream-fallback"))
        self.assertEqual(len(sent), 1)

    def test_both_paths_failing_still_reports_502_with_both_reasons(self):
        def send(request, **kwargs):
            response = MagicMock()
            response.raise_for_status.side_effect = RuntimeError("upstream down")
            return response

        client_mock = MagicMock()
        client_mock.build_request.side_effect = lambda method, url, headers=None: MagicMock(url=url)
        client_mock.send.side_effect = send
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 502)
        detail = response.json()["detail"]
        self.assertIn("transcode", detail)
        self.assertIn("original", detail)

    def test_a_finished_transcode_stream_releases_its_plex_session(self):
        """会话不回收 = 每换一首漏一个转码名额，漏满之后一律被静默降级。

        线上实测过：同一个码率两轮下来"能转"的档位正好相反，
        不是某个码率坏，是名额被自己占满了。
        """
        client_mock, _sent = self._upstream(transcode_ok=True)
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode") as stop,
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
                self.assertEqual(response.status_code, 200)
                response.read()
        stop.assert_called_once_with("sess-1")

    def test_a_transcode_that_never_starts_also_releases_its_session(self):
        client_mock, _sent = self._upstream(transcode_ok=False)
        # 原始音质那条也断掉，逼出 502 分支
        client_mock.send.side_effect = lambda request, **kwargs: (
            lambda r: (setattr(r.raise_for_status, "side_effect", RuntimeError("down")), r)[1]
        )(MagicMock())
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode") as stop,
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 502)
        stop.assert_called_once_with("sess-1")

    def test_a_transcode_that_stalls_before_the_first_byte_falls_back(self):
        """反代等不到响应体就会掐掉连接，用户拿到 502、一点声音都没有 ——
        而应用这边日志还记着 200（线上抓到过）。首字节必须有预算，
        超了就退回原始音质（<1s 就出声）。

        关键是**在响应头发出去之前**就把首字节拿到手：进了 StreamingResponse
        再失败，已经没机会改主意了。
        """
        sent = []

        def send(request, **kwargs):
            url = str(request.url)
            sent.append(url)
            response = MagicMock()
            response.raise_for_status.return_value = None
            response.status_code = 200
            response.headers = {"content-type": "audio/mpeg"}
            if "transcode" in url:
                # Plex 接了请求、给了头，然后迟迟不出第一个字节
                response.iter_bytes.side_effect = httpx.ReadTimeout("first byte never came")
            else:
                response.headers = {"content-type": "audio/flac", "accept-ranges": "bytes"}
                response.iter_bytes.return_value = iter([b"\x00" * 16])
            return response

        client_mock = MagicMock()
        client_mock.build_request.side_effect = lambda method, url, headers=None: MagicMock(url=url)
        client_mock.send.side_effect = send
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode") as stop,
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("x-songlib-stream-mode"), "original")
        self.assertEqual(response.headers.get("x-songlib-stream-fallback"), "1")
        # 卡住的那条会话也要还回去
        stop.assert_called_once_with("sess-1")

    def test_the_transcode_attempt_carries_a_first_byte_deadline(self):
        """原始音质是直读文件，不设限；只有转码那条要卡预算。"""
        timeouts = []

        def make_client(timeout=None, follow_redirects=False):
            timeouts.append(timeout)
            client, _ = self._upstream(transcode_ok=True)
            return client

        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode"),
            patch("app.main.httpx.Client", side_effect=make_client),
        ):
            with TestClient(app) as client:
                self._login(client)
                client.get("/api/player/plex/90056/stream?bitrate=320k").read()
        self.assertEqual(len(timeouts), 1)
        self.assertIsNotNone(timeouts[0])
        self.assertEqual(timeouts[0].read, 4.0)

    def test_seeking_a_transcode_restarts_it_at_a_time_offset(self):
        """转码流没有字节范围，Plex 只能从某个时间点重新起转。

        没有这一步，转码档的进度条是拖不动的（accept-ranges: none，
        线上量过）—— 等于音质选项只做了一半。
        """
        client_mock, sent = self._upstream(transcode_ok=True)
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode"),
            patch.object(
                plex, "transcode_url", return_value="http://plex.test/music/:/transcode/universal/start.mp3?offset=60"
            ) as transcode_url,
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                # 320kbps 下 2,400,000 字节 = 60 秒
                response = client.get(
                    "/api/player/plex/90056/stream?bitrate=320k",
                    headers={"Range": "bytes=2400000-"},
                )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(transcode_url.call_args.kwargs["offset_seconds"], 60.0)
        total = 242 * 320 * 125
        self.assertEqual(response.headers["content-range"], f"bytes 2400000-{total - 1}/{total}")
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        # Range 不能同时转发给上游：Plex 会当没看见并从头给，进度就错位了
        self.assertNotIn("Range", client_mock.build_request.call_args.kwargs.get("headers") or {})

    def test_a_transcode_from_the_start_declares_a_seekable_length(self):
        client_mock, _sent = self._upstream(transcode_ok=True)
        with (
            patch.object(plex, "playback", return_value=self._playback("320k")),
            patch.object(plex, "stop_transcode"),
            patch("app.main.httpx.Client", return_value=client_mock),
        ):
            with TestClient(app) as client:
                self._login(client)
                response = client.get("/api/player/plex/90056/stream?bitrate=320k")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["content-length"], str(242 * 320 * 125))

    def test_every_plex_call_identifies_the_same_client(self):
        """转码会话按客户端归属：stop 不带 X-Plex-Client-Identifier，
        Plex 匹配不上会话直接回 404，名额就没还回去。
        （在 NAS 上对着真 Plex 直接量到的：不带 cid 的 stop 出现 404，
        带上之后稳定 ok。）"""
        captured = {}

        class FakeClient:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *args):
                return False

            def request(self_inner, method, url, params=None, content=None, headers=None):
                captured["headers"] = headers or {}
                captured["url"] = url
                response = MagicMock()
                response.raise_for_status.return_value = None
                return response

        with (
            patch.object(type(plex), "token", new_callable=PropertyMock) as token,
            patch("app.plex.httpx.Client", return_value=FakeClient()),
        ):
            token.return_value = "plex-token"
            plex.stop_transcode("sess-42")
        self.assertIn("X-Plex-Client-Identifier", captured["headers"])
        self.assertEqual(
            captured["headers"]["X-Plex-Client-Identifier"], plex.client_identifier()
        )
        self.assertIn("transcode/universal/stop", captured["url"])

    def test_each_transcode_request_gets_its_own_session_id(self):
        """固定 id（客户端+曲目+码率）会撞上上一次还没关掉的会话。"""
        self.assertNotEqual(plex.new_transcode_session(), plex.new_transcode_session())

    def test_the_transcode_url_carries_a_session_and_client_identifier(self):
        """400 的直接原因：HLS 那条路要求带 session 且客户端要自报身份。"""
        with patch.object(type(plex), "token", new_callable=PropertyMock) as token:
            token.return_value = "plex-token"
            url = plex.transcode_url("90056", "320k")
        self.assertIn("start.mp3", url)
        self.assertIn("protocol=http", url)
        self.assertIn("musicBitrate=320", url)
        self.assertIn("session=", url)
        self.assertIn("X-Plex-Client-Identifier=", url)
        # HLS 只有 Safari 的 <audio> 认，不能再回到 m3u8。
        self.assertNotIn("start.m3u8", url)
        self.assertNotIn("protocol=hls", url)


class HeaderSafetyTests(unittest.TestCase):
    """响应头里放上游错误正文，必须先清成单行 ASCII。

    1.2.3 上线后线上 502：诊断头里放的是 Plex 的错误正文（带换行的 HTML），
    响应头值里出现 \\r\\n，ASGI 服务器直接报错把连接掐掉，反代回 502 ——
    表现是"某些码率完全放不出声"，比它想诊断的那个静默降级还糟。
    """

    def test_newlines_and_control_characters_never_reach_a_header(self):
        from app.main import _header_safe

        dirty = "transcode: 400\r\n<html>\n  <body>Plex 说不行</body>\r\n</html>\x00"
        clean = _header_safe(dirty)
        for bad in ("\r", "\n", "\t", "\x00"):
            self.assertNotIn(bad, clean)
        clean.encode("latin-1")  # 编不动就会抛，等于断言它能当头值

    def test_a_long_body_is_truncated_but_still_single_line(self):
        from app.main import _header_safe

        clean = _header_safe("x\n" * 500)
        self.assertLessEqual(len(clean), 300)
        self.assertNotIn("\n", clean)

    def test_chinese_survives_as_replacement_characters_not_as_a_crash(self):
        from app.main import _header_safe

        # 7 个非 ASCII 字符 → 7 个替换符。重点是"不抛异常、能当头值"，
        # 而不是中文本身能保住（响应头值只能是 latin-1）。
        self.assertEqual(_header_safe("原因：转码失败"), "?" * 7)


class CatalogCacheTests(unittest.TestCase):
    """曲库翻页不许每翻一次就把整个 Plex 库重抓一遍。

    改之前 `/api/library/tracks?pageSize=12` 的实现是"把全部曲目拉下来、
    切 12 条返回"。1526 首要分 500 条抓 4 次，实测单次请求 2.9–3.1 秒，
    而前端还要继续加载剩下的 1300 多项 —— 每翻一页全量重抓一次。
    曲库页那个"0 项 / 正在读取音乐库…"就是这么来的。
    """

    def setUp(self):
        plex.invalidate_catalog()

    def tearDown(self):
        plex.invalidate_catalog()

    @staticmethod
    def _library(count):
        rows = "".join(
            f'<Track ratingKey="t{i}" title="曲目 {i}" grandparentTitle="歌手" parentTitle="专辑" duration="200000" />'
            for i in range(count)
        )
        return ET.fromstring(f'<MediaContainer size="{count}">{rows}</MediaContainer>')

    def test_paging_the_library_fetches_plex_only_once(self):
        calls = []

        def xml(path, params=None, **kwargs):
            calls.append(path)
            start = int((params or {}).get("X-Plex-Container-Start") or 0)
            return self._library(0 if start else 30)

        with (
            patch.object(plex, "xml", side_effect=xml),
            patch.object(plex, "enabled_library_keys", return_value=["26"]),
        ):
            first = plex.tracks()
            for _ in range(5):
                plex.tracks()
        self.assertEqual(len(first), 30)
        # 六次调用只抓一轮（一轮 = 拿到不足 500 条就停，这里 1 次）
        self.assertEqual(len(calls), 1, f"翻页把 Plex 重抓了 {len(calls)} 次")

    def test_searching_runs_against_the_cache_not_against_plex(self):
        calls = []

        def xml(path, params=None, **kwargs):
            calls.append(path)
            return self._library(3)

        with (
            patch.object(plex, "xml", side_effect=xml),
            patch.object(plex, "enabled_library_keys", return_value=["26"]),
        ):
            plex.tracks()
            hit = plex.tracks(search="曲目 1")
        self.assertEqual(len(calls), 1)
        self.assertEqual([item["title"] for item in hit], ["曲目 1"])

    def test_a_scan_drops_the_cache_so_new_songs_show_up(self):
        calls = []

        def xml(path, params=None, **kwargs):
            calls.append(path)
            return self._library(2)

        with (
            patch.object(plex, "xml", side_effect=xml),
            patch.object(plex, "enabled_library_keys", return_value=["26"]),
        ):
            plex.tracks()
            plex.invalidate_catalog()
            plex.tracks()
        self.assertEqual(len(calls), 2, "清过缓存之后应该重新抓一次")

    def test_different_media_types_do_not_share_a_cache_entry(self):
        seen = []

        def xml(path, params=None, **kwargs):
            seen.append((params or {}).get("type"))
            return self._library(1)

        with (
            patch.object(plex, "xml", side_effect=xml),
            patch.object(plex, "enabled_library_keys", return_value=["26"]),
        ):
            plex.artists()
            plex.albums()
            plex.tracks()
            plex.artists()
        # 8/9/10 各抓一次，第二次 artists 命中缓存
        self.assertEqual(seen, [8, 9, 10])
