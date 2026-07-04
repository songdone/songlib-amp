from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from . import auth
from .db import init_db, row
from .sources import SourceError, import_file, inspect_source, set_enabled, test_resolve, test_search


def import_source(path: Path):
    data = path.read_bytes()
    try:
        return import_file("", path.name, "application/javascript", data)
    except SourceError as exc:
        if exc.code != "SOURCE_DUPLICATE":
            raise
        digest = hashlib.sha256(data.decode("utf-8-sig").encode("utf-8")).hexdigest()
        existing = row("SELECT id FROM source_plugins WHERE file_sha256=?", (digest,))
        if not existing:
            raise
        inspection = inspect_source(existing["id"])
        return {"ok": True, "duplicate": True, "source_id": existing["id"], "inspection": inspection,
                "message": "音乐源已存在，已重新执行格式检查。"}


def smoke_test(result: dict, platform: str, quality: str):
    source_id = result.get("source_id") or (result.get("source") or {}).get("id")
    if not source_id:
        raise SourceError("SOURCE_IMPORT_FAILED", "音乐源导入结果缺少 ID，无法执行真实可用性测试。")
    search_result = test_search(source_id, "周杰伦 晴天", platform)
    tracks = search_result.get("results") or []
    track = next((item for item in tracks if "晴天" in item.get("title", "")), tracks[0] if tracks else None)
    if not track:
        raise SourceError("SOURCE_SEARCH_EMPTY", "真实搜索测试没有返回可解析歌曲。")
    resolve_result = test_resolve(source_id, track, quality)
    enabled_source = set_enabled(source_id, True)
    return {
        "ok": True,
        "keyword": "周杰伦 晴天",
        "platform": search_result.get("platform"),
        "searchCount": search_result.get("count"),
        "track": {key: track.get(key) for key in ("id", "title", "artist", "album")},
        "quality": quality,
        "probe": resolve_result.get("resolved"),
        "enabled": enabled_source.get("enabled"),
    }


def main():
    parser = argparse.ArgumentParser(prog="songlib-cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    import_parser = subparsers.add_parser("import-source")
    import_parser.add_argument("path", type=Path)
    import_parser.add_argument("--smoke-test", action="store_true", help="执行 QQ 搜索、URL 解析和音频字节探测，并在成功后启用")
    import_parser.add_argument("--platform", default="tx")
    import_parser.add_argument("--quality", default="128k")
    reset_parser = subparsers.add_parser("reset-admin")
    reset_parser.add_argument("--from-env", action="store_true", help="把 admin 密码重置为 .env 中的 APP_PASSWORD")
    reset_parser.add_argument("--password", default="", help="直接指定新的 admin 密码（至少 10 位）")
    args = parser.parse_args()
    init_db()
    if args.command == "import-source":
        result = import_source(args.path)
        if args.smoke_test:
            try:
                result["smokeTest"] = smoke_test(result, args.platform, args.quality)
            except SourceError as exc:
                result["smokeTest"] = {"ok": False, "errorCode": exc.code, "message": exc.message}
        print(json.dumps(result, ensure_ascii=False))
    elif args.command == "reset-admin":
        if args.from_env:
            result = auth.reset_admin_from_env()
        elif args.password:
            auth.ensure_bootstrap_password()
            admin = row("SELECT * FROM users WHERE username='admin'") or row("SELECT * FROM users ORDER BY created_at LIMIT 1")
            auth.reset_password(admin["id"], args.password)
            result = {"ok": True, "username": admin["username"], "reset": True}
        else:
            raise SystemExit("请传入 --from-env 或 --password")
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
