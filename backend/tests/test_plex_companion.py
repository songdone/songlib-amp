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

    @staticmethod
    def client_identifier():
        return "songlib-amp-test"

    def client_headers(self):
        return {"X-Plex-Client-Identifier": self.client_identifier()}

    # timeout 是 sessions() 的轮询预算（POLL_TIMEOUT_SECONDS）传进来的：
    # 这个接口前端每 4 秒轮一次，不能沿用 60 秒默认超时。
    def xml(self, path, timeout=None):
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
        # 默认掐掉 plex.tv 那条发现路径：测试必须离网跑。
        # 想验它的用例自己去 patch _companion_players（见下面那两条）。
        patcher = patch.object(PlexCompanion, "_companion_players", return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
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

        def xml(path, timeout=None):
            if path == "/clients":
                raise RuntimeError("clients endpoint unavailable")
            return original(path)

        source.xml = xml
        result = PlexCompanion(source).sessions()
        self.assertEqual(result["sessions"][0]["title"], "夜曲")
        self.assertFalse(result["sessions"][0]["controllable"])
        self.assertTrue(result["clientWarning"])

    @patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168."))
    def test_recent_client_snapshot_prevents_control_state_flapping(self, _private):
        source = FakePlex()
        companion = PlexCompanion(source)
        first = companion.sessions()
        self.assertTrue(first["sessions"][0]["controllable"])

        original = source.xml

        def xml(path, timeout=None):
            if path == "/clients":
                return ET.fromstring('<MediaContainer size="0" />')
            return original(path)

        source.xml = xml
        second = companion.sessions()
        self.assertTrue(second["sessions"][0]["controllable"])
        self.assertTrue(second["clientsStale"])
        self.assertTrue(second["clientWarning"])


class CompanionDiscoveryTests(unittest.TestCase):
    """Plexamp 只在 plex.tv 的设备清单里，不在服务端 /clients 里。

    以前只读 /clients，于是 Plexamp 的会话看得见、却配不上任何 client，
    `controllable` 恒为 False —— 界面上就是"只显示仅跟随、点了没反应"。
    """

    RESOURCES = [
        {
            "name": "客厅 Plexamp",
            "product": "Plexamp",
            "platform": "macOS",
            "productVersion": "4.10.1",
            "clientIdentifier": "client-playback",
            "provides": "player,pubsub-player,controller",
            "presence": True,
            "connections": [
                {"address": "8.8.8.8", "port": 32500, "protocol": "http", "local": False},
                {"address": "192.168.1.77", "port": 32500, "protocol": "http", "local": True},
            ],
        },
        {
            # 只提供 server，不是播放器，不该出现在列表里
            "name": "NAS",
            "product": "Plex Media Server",
            "clientIdentifier": "server-1",
            "provides": "server",
            "connections": [{"address": "192.168.1.5", "port": 32400, "protocol": "http"}],
        },
        {
            # 播放器，但只有公网地址 —— 只能跟随，不许往外发控制请求
            "name": "外网 Plexamp",
            "product": "Plexamp",
            "clientIdentifier": "client-wan",
            "provides": "player",
            "presence": True,
            "connections": [{"address": "203.0.113.9", "port": 32500, "protocol": "https"}],
        },
    ]

    def _companion(self):
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.return_value = self.RESOURCES
        http = MagicMock()
        http.get.return_value = response
        http.__enter__ = lambda self_: self_
        http.__exit__ = lambda *args: False
        return PlexCompanion(FakePlex()), http

    def test_a_companion_player_on_the_lan_becomes_controllable(self):
        companion, http = self._companion()
        source = FakePlex()

        def xml(path, timeout=None):
            if path == "/clients":
                return ET.fromstring('<MediaContainer size="0" />')
            return FakePlex.xml(source, path, timeout)

        source.xml = xml
        companion.plex = source
        with (
            patch("app.plex_companion.httpx.Client", return_value=http),
            patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168.")),
        ):
            result = companion.sessions()
        session = result["sessions"][0]
        self.assertTrue(session["controllable"], session["controlReason"])
        found = {item["id"]: item for item in result["clients"]}
        self.assertIn("client-playback", found)
        self.assertEqual(found["client-playback"]["source"], "plex.tv")

    def test_only_players_on_private_addresses_are_controllable(self):
        companion, http = self._companion()
        with (
            patch("app.plex_companion.httpx.Client", return_value=http),
            patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168.")),
        ):
            players = {item["id"]: item for item in companion._companion_players()}
        # 只提供 server 的那台不算播放器
        self.assertNotIn("server-1", players)
        self.assertTrue(players["client-playback"]["controllable"])
        # 只有公网地址的那台必须是"仅跟随"，不能拿这个接口当 SSRF 跳板
        self.assertFalse(players["client-wan"]["controllable"])
        self.assertIn("本地网络", players["client-wan"]["controlReason"])

    def test_plex_tv_being_unreachable_does_not_break_the_clients_endpoint(self):
        """plex.tv 够不到（离线、Token 只有服务器权限）时，/clients 那条路还得好。"""
        companion = PlexCompanion(FakePlex())
        with (
            patch("app.plex_companion.httpx.Client", side_effect=RuntimeError("plex.tv unreachable")),
            patch("app.plex_companion._private_address", side_effect=lambda host: host.startswith("192.168.")),
        ):
            result = companion.sessions()
        self.assertTrue(result["sessions"][0]["controllable"])


if __name__ == "__main__":
    unittest.main()
