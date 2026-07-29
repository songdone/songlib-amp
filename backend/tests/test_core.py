import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="pmm-tests-"))
os.environ.setdefault("MUSIC_ROOT", tempfile.mkdtemp(prefix="pmm-music-"))
os.environ.setdefault("PLEX_CONFIG", tempfile.mkdtemp(prefix="pmm-plex-"))

from app.auth import hash_password, verify_password
from app.db import init_db, rows, transaction
from app.downloader import safe_name, validate_public_url
from app.local_library import local_library
from app.lyrics import artist_match, norm
from app.sources import (
    SourceError,
    _inspect_path,
    _validate_script_bytes,
    delete_source,
    import_file,
    set_enabled,
    source_metadata,
    validate_source,
)


class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def test_password_hash(self):
        encoded = hash_password("hello-plex-123")
        self.assertTrue(verify_password("hello-plex-123", encoded))
        self.assertFalse(verify_password("wrong", encoded))

    def test_safe_filename(self):
        self.assertEqual(safe_name('S.H.E / 恋人未满?'), "S.H.E _ 恋人未满_")

    def test_local_download_url_is_blocked(self):
        with self.assertRaises(ValueError):
            validate_public_url("http://127.0.0.1/private")

    def test_artist_matching(self):
        self.assertTrue(artist_match("S.H.E", "S.H.E"))
        self.assertTrue(artist_match("伍佰/China Blue", "伍佰"))
        self.assertFalse(artist_match("周杰伦", "林俊杰"))

    def test_source_rejects_html_with_specific_code(self):
        with self.assertRaises(SourceError) as raised:
            _validate_script_bytes(b"<!doctype html><html>not javascript</html>")
        self.assertEqual(raised.exception.code, "SOURCE_URL_RETURNED_HTML")

    def test_fixture_source_loads_in_isolated_bridge(self):
        fixture = Path(__file__).parent / "fixtures" / "test-source.js"
        script = fixture.read_text(encoding="utf-8")
        self.assertEqual(source_metadata(script)["name"], "Test Source")
        info = validate_source(fixture)
        self.assertIn("tx", info["sources"])
        inspected = _inspect_path(fixture)
        self.assertEqual(inspected["detected_format"], "lx-event")

    def test_valid_source_is_enabled_without_search_gate(self):
        fixture = Path(__file__).parent / "fixtures" / "test-source.js"
        script = fixture.read_bytes() + b"\n// default-enable-contract\n"
        with transaction() as conn:
            conn.execute(
                "DELETE FROM source_plugins WHERE file_sha256=?",
                (__import__("hashlib").sha256(script).hexdigest(),),
            )
        result = import_file(
            "Default enabled source",
            "default-enabled.js",
            "application/javascript",
            script,
        )
        source = result["source"]
        try:
            self.assertTrue(result["ok"])
            self.assertTrue(source["enabled"])
            self.assertFalse(source["searchOk"])
            set_enabled(source["id"], False)
            enabled = set_enabled(source["id"], True)
            self.assertTrue(enabled["enabled"])
        finally:
            delete_source(source["id"])

    def test_obfuscated_javascript_is_not_rejected_by_text_guessing(self):
        script = "/*! @name 混淆源 */;(function(a){return a^42})(7)".encode()
        self.assertIn("function", _validate_script_bytes(script))

    def test_plex_sync_persists_artists_albums_and_tracks(self):
        artist = {"ratingKey": "a1", "guid": "artist://1", "title": "周杰伦", "sectionKey": "26"}
        album = {"ratingKey": "b1", "guid": "album://1", "title": "叶惠美", "parentTitle": "周杰伦", "parentRatingKey": "a1", "sectionKey": "26"}
        track = {"ratingKey": "t1", "guid": "track://1", "title": "晴天", "grandparentTitle": "周杰伦", "grandparentRatingKey": "a1", "parentTitle": "叶惠美", "parentRatingKey": "b1", "sectionKey": "26", "file": "/media/音乐/周杰伦/叶惠美/03 - 晴天.flac"}
        with transaction() as conn:
            conn.execute("DELETE FROM plex_items")
        with patch("app.local_library.plex.artists", return_value=[artist]), patch("app.local_library.plex.albums", return_value=[album]), patch("app.local_library.plex.tracks", return_value=[track]):
            result = local_library.sync_plex({}, lambda *args: None)
        self.assertEqual(result["artists"], 1)
        self.assertEqual({item["type"] for item in rows("SELECT type FROM plex_items")}, {"artist", "album", "track"})


if __name__ == "__main__":
    unittest.main()
