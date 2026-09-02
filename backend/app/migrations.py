from __future__ import annotations

import sqlite3
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


MIGRATIONS: tuple[tuple[int, str, str], ...] = (
    (
        1,
        "commercial_foundation",
        """
        CREATE TABLE IF NOT EXISTS media_connections (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          config TEXT NOT NULL DEFAULT '{}',
          secret_ref TEXT,
          last_test_status TEXT,
          last_test_message TEXT,
          last_test_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS path_mappings (
          id TEXT PRIMARY KEY,
          connection_id TEXT,
          source_prefix TEXT NOT NULL,
          target_prefix TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 100,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(connection_id) REFERENCES media_connections(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS provider_connections (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          capabilities TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 0,
          config TEXT NOT NULL DEFAULT '{}',
          secret_ref TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          source_kind TEXT NOT NULL DEFAULT 'local',
          source_ref TEXT,
          cover_ref TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(owner_id, name),
          FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS playlist_items (
          id TEXT PRIMARY KEY,
          playlist_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          file_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          artist TEXT NOT NULL DEFAULT '',
          album TEXT NOT NULL DEFAULT '',
          duration INTEGER,
          path TEXT,
          external_ref TEXT,
          match_status TEXT NOT NULL DEFAULT 'matched',
          created_at TEXT NOT NULL,
          UNIQUE(playlist_id, position),
          FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);
        CREATE TABLE IF NOT EXISTS listening_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          file_id TEXT,
          external_ref TEXT,
          event_type TEXT NOT NULL,
          position_ms INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          context TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_listening_events_user_time ON listening_events(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS recommendation_profiles (
          user_id TEXT PRIMARY KEY,
          profile TEXT NOT NULL DEFAULT '{}',
          event_count INTEGER NOT NULL DEFAULT 0,
          generated_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS recommendation_candidates (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT NOT NULL DEFAULT '',
          duration_ms INTEGER,
          external_ref TEXT,
          in_library INTEGER NOT NULL DEFAULT 0,
          score REAL NOT NULL DEFAULT 0,
          reasons TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'ready',
          created_at TEXT NOT NULL,
          expires_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recommendation_user_score ON recommendation_candidates(user_id, score DESC);
        CREATE TABLE IF NOT EXISTS quarantine_items (
          id TEXT PRIMARY KEY,
          job_id INTEGER,
          original_path TEXT,
          quarantine_path TEXT,
          reason_code TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'held',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          actor_id TEXT,
          request_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          outcome TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at DESC);
        """,
    ),
    (
        2,
        "playback_positions",
        """
        -- 跨设备续播：每个用户、每首歌记一个播放位置。
        --
        -- 主键是 (user_id, track_key)，不是自增 id —— 同一首歌只该有
        -- 一条记录，用自增 id 的话每次上报都插一行，一晚上就几千条。
        --
        -- track_key 用前端的 trackIdentity()（canonicalKey / plex-xxx /
        -- local-xxx / 规范化后的 曲名|歌手|专辑）。它对同一首歌的本地
        -- 文件和 Plex 版本给出同一个 key，这正是"手机上听 Plex、
        -- 回电脑接着本地文件听"能续上的前提。
        --
        -- title/artist/cover_url 是冗余的快照，为的是"继续听"能在
        -- 曲库还没加载完时就渲染出来，也能在原文件被删之后仍然
        -- 显示得出这条记录是什么。
        CREATE TABLE IF NOT EXISTS playback_positions (
          user_id TEXT NOT NULL,
          track_key TEXT NOT NULL,
          position_seconds REAL NOT NULL DEFAULT 0,
          duration_seconds REAL NOT NULL DEFAULT 0,
          title TEXT NOT NULL DEFAULT '',
          artist TEXT NOT NULL DEFAULT '',
          album TEXT NOT NULL DEFAULT '',
          cover_url TEXT NOT NULL DEFAULT '',
          track TEXT NOT NULL DEFAULT '{}',
          device TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, track_key),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_playback_recent
          ON playback_positions(user_id, updated_at DESC);
        """,
    ),
)


def apply_migrations(conn: sqlite3.Connection) -> list[int]:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
             version INTEGER PRIMARY KEY,
             name TEXT NOT NULL,
             applied_at TEXT NOT NULL
           )"""
    )
    applied = {item["version"] for item in conn.execute("SELECT version FROM schema_migrations")}
    completed: list[int] = []
    for version, name, sql in MIGRATIONS:
        if version in applied:
            continue
        conn.executescript(sql)
        conn.execute(
            "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
            (version, name, _now()),
        )
        completed.append(version)
    return completed
