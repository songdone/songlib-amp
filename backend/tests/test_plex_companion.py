import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch

os.environ.setdefault("APP_PASSWORD", "test-password-123")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-for-songlib-123456")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="plex-companion-tests-"))

from app.plex_companion import PlexCompanion, _private_address


class FakePlex:
    token = "test-token"

    def xml(self, path):
        if path == "/clients":
            return ET.fromstring(
                """
                <MediaContainer size="2">
                  <Server name="Studio Plexamp" host="192.168.1.42" port="32500"
                    machineIdentifier="client-playback" product="Plexamp"
                    platform="macOS" protocol="http" protocolCapabilities="playback,timeline" />
                  <Server name="Remote Player" host="8.8.8.8" port="32500"
                    machineIdentifier="client-remote" product="Plex"
                    protocol="http" protocolCapabilities="playback" />
                </MediaContainer>
                """
            )
        if path == "/status/sessions":
            return ET.fromstring(
                """
                <MediaContainer size="1">
                  <Track sessionKey="10" ratingKey="123" title="夜曲"
                    grandparentTitle="周杰伦" parentTitle="十一月的萧邦"
                    duration="242000" viewOffset="102000" thumb="/library/metadata/123/thumb/1">
                    <User title="listener" />
                    <Player address="192.168.1.42" machineIdentifier="client-playback"
                      model="Plexamp" platform="macOS" product="Plexamp"
                      state="playing" title="Studio Plexamp" local="1" secure="1" />
                    <Session id="session-123" bandwidth="1800" />
                  </Track>
                </MediaContainer>
                """
            )
        raise AssertionError(path)


class PlexCompanionTests(unittest.TestCase):
    def setUp(self):
        self.companion = PlexCompanion(FakePlex())

    def test_control_target_requires_literal_private_address(self):
        self.assertTrue(_private_address("192.168.1.42"))
        self.assertFalse(_private_address("player.example.test"))
        self.assertFalse(_private_address("8.8.8.8"))

    @patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168."))
    def test_sessions_merge_live_track_with_controllable_client(self, _private):
        result = self.companion.sessions()
        self.assertEqual(len(result["sessions"]), 1)
        session = result["sessions"][0]
        self.assertEqual(session["id"], "session-123")
        self.assertEqual(session["ratingKey"], "123")
        self.assertEqual(session["positionMs"], 102000)
        self.assertTrue(session["playing"])
        self.assertTrue(session["controllable"])
        self.assertEqual(session["volume"], 100)
        self.assertTrue(session["coverUrl"].startswith("/api/plex/image?path="))
        public_client = next(item for item in result["clients"] if item["id"] == "client-playback")
        self.assertNotIn("_host", public_client)
        self.assertNotIn("_port", public_client)

    @patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168."))
    @patch("app.plex_companion.PlexCompanion.controller_identifier", return_value="controller-test")
    @patch("app.plex_companion.httpx.Client")
    def test_pause_command_targets_only_registered_private_client(self, client_type, _identifier, _private):
        response = MagicMock()
        response.raise_for_status.return_value = None
        client = client_type.return_value.__enter__.return_value
        client.get.return_value = response

        result = self.companion.command("client-playback", "pause")

        self.assertTrue(result["ok"])
        url = client.get.call_args.args[0]
        kwargs = client.get.call_args.kwargs
        self.assertEqual(url, "http://192.168.1.42:32500/player/playback/pause")
        self.assertEqual(kwargs["params"]["type"], "music")
        self.assertEqual(
            kwargs["headers"]["X-Plex-Target-Client-Identifier"],
            "client-playback",
        )

    @patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168."))
    @patch("app.plex_companion.PlexCompanion.controller_identifier", return_value="controller-test")
    @patch("app.plex_companion.httpx.Client")
    def test_volume_command_is_bounded_for_registered_client(self, client_type, _identifier, _private):
        response = MagicMock()
        response.raise_for_status.return_value = None
        client = client_type.return_value.__enter__.return_value
        client.get.return_value = response

        self.companion.command("client-playback", "volume", 140)

        self.assertEqual(
            client.get.call_args.args[0],
            "http://192.168.1.42:32500/player/playback/setParameters",
        )
        self.assertEqual(client.get.call_args.kwargs["params"]["volume"], 100)

    @patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168."))
    def test_remote_public_client_is_follow_only(self, _private):
        clients = {item["id"]: item for item in self.companion.clients()}
        self.assertFalse(clients["client-remote"]["controllable"])
        with self.assertRaises(PermissionError):
            self.companion.command("client-remote", "pause")

    def test_active_session_remains_visible_when_clients_endpoint_is_unavailable(self):
        source = FakePlex()
        original = source.xml

        def xml(path):
            if path == "/clients":
                raise RuntimeError("clients endpoint unavailable")
            return original(path)

        source.xml = xml
        result = PlexCompanion(source).sessions()
        self.assertEqual(result["sessions"][0]["title"], "夜曲")
        self.assertFalse(result["sessions"][0]["controllable"])
        self.assertTrue(result["clientWarning"])


if __name__ == "__main__":
    unittest.main()
