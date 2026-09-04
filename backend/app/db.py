from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings
from .migrations import apply_migrations


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  source_type TEXT NOT NULL,
  original_url TEXT,
  original_filename TEXT,
  stored_filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unverified',
  detected_format TEXT,
  compatibility TEXT,
  inspect_result TEXT NOT NULL DEFAULT '{}',
  supported_platforms TEXT NOT NULL DEFAULT '[]',
  supported_qualities TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  success_rate REAL NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  concurrency_limit INTEGER NOT NULL DEFAULT 1,
  last_test_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  search_ok INTEGER NOT NULL DEFAULT 0,
  resolve_ok INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  level TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES source_plugins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  source_id INTEGER,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,
  format TEXT,
  bitrate INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  duration INTEGER,
  title TEXT,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  year TEXT,
  track_number TEXT,
  disc_number TEXT,
  genre TEXT,
  has_cover INTEGER DEFAULT 0,
  has_lrc INTEGER DEFAULT 0,
  cover_path TEXT,
  cover_source TEXT,
  lyric_path TEXT,
  tags_inferred TEXT NOT NULL DEFAULT '[]',
  plex_rating_key TEXT,
  plex_matched INTEGER DEFAULT 0,
  path_rule_ok INTEGER DEFAULT 0,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plex_items (
  id TEXT PRIMARY KEY,
  rating_key TEXT NOT NULL UNIQUE,
  guid TEXT,
  type TEXT NOT NULL,
  section_key TEXT,
  parent_rating_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  year TEXT,
  duration INTEGER,
  file_path TEXT,
  thumb TEXT,
  art TEXT,
  summary TEXT,
  artist_bio_zh TEXT,
  album_description_zh TEXT,
  metadata_source TEXT,
  cover_path TEXT,
  poster_path TEXT,
  background_path TEXT,
  has_cover INTEGER DEFAULT 0,
  has_background INTEGER DEFAULT 0,
  has_lyrics INTEGER DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_state TEXT,
  after_state TEXT,
  rollback_data TEXT,
  rollbackable INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS play_history (
  id TEXT PRIMARY KEY,
  file_id TEXT,
  title TEXT,
  artist TEXT,
  played_at TEXT NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
"""


_init_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def init_db():
    with _init_lock:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.source_dir.mkdir(parents=True, exist_ok=True)
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        # transaction() 会提交并**关闭**连接；原来这里是 `with connect()`，
        # 那只提交不关，启动时就先漏一个（见 reading() 上面那段注释）。
        with transaction() as conn:
            conn.executescript(SCHEMA)
            _ensure_columns(conn, "jobs", {
                "source_id": "TEXT",
                "error_code": "TEXT",
                "error_message": "TEXT",
                "input": "TEXT NOT NULL DEFAULT '{}'",
                "output": "TEXT NOT NULL DEFAULT '{}'",
                "success_count": "INTEGER NOT NULL DEFAULT 0",
                "failed_count": "INTEGER NOT NULL DEFAULT 0",
                "skipped_count": "INTEGER NOT NULL DEFAULT 0",
                "cancel_requested": "INTEGER NOT NULL DEFAULT 0",
                "idempotency_key": "TEXT",
                "attempt": "INTEGER NOT NULL DEFAULT 0",
                "max_attempts": "INTEGER NOT NULL DEFAULT 3",
                "lease_owner": "TEXT",
                "lease_expires_at": "TEXT",
                "checkpoint": "TEXT NOT NULL DEFAULT '{}'",
                "next_run_at": "TEXT",
                "updated_at": "TEXT",
            })
            _ensure_columns(conn, "files", {
                "cover_path": "TEXT",
                "cover_source": "TEXT",
                "lyric_path": "TEXT",
                "tags_inferred": "TEXT NOT NULL DEFAULT '[]'",
            })
            _ensure_columns(conn, "plex_items", {
                "section_key": "TEXT",
                "parent_rating_key": "TEXT",
                "summary": "TEXT",
                "artist_bio_zh": "TEXT",
                "album_description_zh": "TEXT",
                "metadata_source": "TEXT",
                "cover_path": "TEXT",
                "poster_path": "TEXT",
                "background_path": "TEXT",
            })
            _ensure_columns(conn, "source_plugins", {
                "detected_format": "TEXT",
                "compatibility": "TEXT",
                "inspect_result": "TEXT NOT NULL DEFAULT '{}'",
                "success_rate": "REAL NOT NULL DEFAULT 0",
                "timeout_ms": "INTEGER NOT NULL DEFAULT 10000",
                "concurrency_limit": "INTEGER NOT NULL DEFAULT 1",
            })
            _ensure_columns(conn, "users", {
                "display_name": "TEXT NOT NULL DEFAULT ''",
                "role": "TEXT NOT NULL DEFAULT 'admin'",
                "enabled": "INTEGER NOT NULL DEFAULT 1",
                "last_login_at": "TEXT",
            })
            _migrate_legacy_sources(conn)
            _migrate_legacy_admin_user(conn)
            apply_migrations(conn)
            conn.execute(
                """UPDATE jobs
                   SET status='queued', lease_owner=NULL, lease_expires_at=NULL,
                       message='服务恢复后等待继续', next_run_at=COALESCE(next_run_at, ?), updated_at=?
                   WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)""",
                (now(), now(), now()),
            )
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_runnable ON jobs(status,next_run_at,created_at)")


def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]):
    existing = {item["name"] for item in conn.execute(f"PRAGMA table_info({table})")}
    for name, declaration in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")


def _migrate_legacy_sources(conn: sqlite3.Connection):
    """Preserve old source rows, but require a fresh health test before download."""
    for item in conn.execute("SELECT * FROM sources").fetchall():
        plugin_id = f"legacy-{item['id']}"
        exists = conn.execute("SELECT 1 FROM source_plugins WHERE id=?", (plugin_id,)).fetchone()
        if exists:
            continue
        path = settings.source_dir / item["filename"]
        if not path.exists():
            continue
        import hashlib
        data = path.read_bytes()
        metadata = json.loads(item["metadata"] or "{}")
        platforms = list((metadata.get("capabilities") or {}).keys())
        conn.execute(
            """INSERT INTO source_plugins(
              id,name,display_name,source_type,original_url,original_filename,stored_filename,stored_path,
              file_sha256,file_size,enabled,status,supported_platforms,metadata,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                plugin_id, item["name"], item["name"], "url", item["url"], None,
                item["filename"], str(path), hashlib.sha256(data).hexdigest(), len(data), 0,
                "imported", json.dumps(platforms, ensure_ascii=False), json.dumps(metadata, ensure_ascii=False),
                item["created_at"], now(),
            ),
        )


def _migrate_legacy_admin_user(conn: sqlite3.Connection):
    if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        return
    legacy = conn.execute("SELECT value FROM kv WHERE key='password_hash'").fetchone()
    if not legacy:
        return
    try:
        password_hash = json.loads(legacy["value"])
    except json.JSONDecodeError:
        password_hash = legacy["value"]
    if not password_hash:
        return
    stamp = now()
    conn.execute(
        """INSERT OR IGNORE INTO users(id,username,display_name,password_hash,role,enabled,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        ("admin", "admin", "管理员", password_hash, "admin", 1, stamp, stamp),
    )


@contextmanager
def reading():
    """只读查询用的连接，**用完一定关掉**。

    这里踩过一个大坑：`rows()` / `row()` / `get_kv()` 原来都写成
    `with connect() as conn:` —— 但 Python 的 sqlite3 里 `with conn:` 是
    **事务**上下文管理器，它只负责提交/回滚，**不关连接**。
    于是每一次查询都漏一个连接。

    后果不只是文件描述符：WAL 模式下没关闭的连接会挡住 checkpoint，
    WAL 越长写越慢，最后写事务拿不到锁 —— 线上抓到过登录等了 31 秒
    然后 `sqlite3.OperationalError: database is locked`（busy_timeout
    本来就是 30 秒）。容器只跑了 15 分钟，指向 manager.db 的 fd 已经 30 个。
    """
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_kv(key: str, default=None):
    with reading() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return row["value"]


def set_kv(key: str, value):
    encoded = json.dumps(value, ensure_ascii=False)
    with transaction() as conn:
        conn.execute(
            "INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            (key, encoded, now()),
        )


def rows(query: str, params=()):
    with reading() as conn:
        return [dict(row) for row in conn.execute(query, params).fetchall()]


def row(query: str, params=()):
    with reading() as conn:
        result = conn.execute(query, params).fetchone()
        return dict(result) if result else None
