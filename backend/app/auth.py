from __future__ import annotations

import hashlib
import hmac
import secrets
import re
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import settings
from .db import get_kv, now, row, rows, set_kv, transaction
from .security import CSRF_COOKIE, issue_csrf


COOKIE_NAME = "songlib_session"
MAX_AGE = 60 * 60 * 24 * 14


def _secret() -> str:
    configured = settings.session_secret.strip()
    if configured:
        return configured
    current = get_kv("session_secret")
    if not current:
        current = secrets.token_urlsafe(48)
        set_kv("session_secret", current)
    return current


def _serializer():
    return URLSafeTimedSerializer(_secret(), salt="plex-music-manager")


def hash_password(password: str, salt: str | None = None) -> str:
    salt_bytes = bytes.fromhex(salt) if salt else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt_bytes, 600_000, dklen=32)
    return f"pbkdf2-sha256${salt_bytes.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, expected = encoded.split("$", 2)
        if algorithm != "pbkdf2-sha256":
            return False
        actual = hash_password(password, salt).split("$", 2)[2]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _normalize_username(username: str) -> str:
    value = (username or "admin").strip().lower()
    if not re.fullmatch(r"[a-z0-9_.@-]{2,40}", value):
        raise HTTPException(status_code=400, detail="用户名只能包含 2-40 位字母、数字、点、下划线、@ 或短横线")
    return value


def _public_user(item: dict | None):
    if not item:
        return None
    role = item.get("role") or "admin"
    default_permissions = {
        "admin": ["listen", "manage_library", "manage_sources", "manage_users", "view_logs"],
        "owner": ["listen", "manage_library", "manage_sources", "manage_users", "view_logs"],
        "library_admin": ["listen", "manage_library", "manage_sources", "view_logs"],
        "listener": ["listen"],
    }.get(role, ["listen"])
    access = (get_kv("user_access", {}) or {}).get(item["id"], {})
    permissions = access.get("permissions") or default_permissions
    return {
        "id": item["id"],
        "username": item["username"],
        "displayName": item.get("display_name") or item["username"],
        "role": role,
        "permissions": permissions,
        "libraryScopes": access.get("libraryScopes") or (["*"] if role in ("admin", "owner", "library_admin") else []),
        "enabled": bool(item.get("enabled", 1)),
        "createdAt": item.get("created_at"),
        "updatedAt": item.get("updated_at"),
        "lastLoginAt": item.get("last_login_at"),
    }


def setup_required() -> bool:
    return row("SELECT 1 AS value FROM users LIMIT 1") is None


def ensure_bootstrap_password():
    existing = row("SELECT * FROM users LIMIT 1")
    if existing:
        return False
    legacy_hash = get_kv("password_hash")
    password_hash = legacy_hash or (hash_password(settings.app_password) if settings.app_password else "")
    if not password_hash:
        return False
    stamp = now()
    with transaction() as conn:
        conn.execute(
            """INSERT INTO users(id,username,display_name,password_hash,role,enabled,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            ("admin", "admin", "管理员", password_hash, "owner", 1, stamp, stamp),
        )
    if not legacy_hash:
        set_kv("password_hash", password_hash)
    return True


def complete_setup(username: str, password: str, display_name: str = ""):
    username = _normalize_username(username)
    if len(password or "") < 12:
        raise HTTPException(status_code=400, detail="密码至少需要 12 个字符")
    stamp = now()
    with transaction() as conn:
        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise HTTPException(status_code=409, detail="初始设置已经完成")
        user_id = secrets.token_hex(8)
        conn.execute(
            """INSERT INTO users(id,username,display_name,password_hash,role,enabled,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (user_id, username, display_name.strip() or username, hash_password(password), "owner", 1, stamp, stamp),
        )
    return _public_user(row("SELECT * FROM users WHERE id=?", (user_id,)))


def login(response: Response, password: str, username: str = "admin"):
    username = _normalize_username(username or "admin")
    user = row("SELECT * FROM users WHERE username=?", (username,))
    if not user and username == "admin":
        user = row("SELECT * FROM users ORDER BY created_at LIMIT 1")
    if not user or not user.get("enabled"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    stamp = now()
    with transaction() as conn:
        conn.execute("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?", (stamp, stamp, user["id"]))
    token = _serializer().dumps({
        "uid": user["id"],
        "username": user["username"],
        "role": user["role"],
        "issued": datetime.now(timezone.utc).isoformat(),
    })
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    issue_csrf(response)
    return _public_user(row("SELECT * FROM users WHERE id=?", (user["id"],)))


def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/", secure=settings.cookie_secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=settings.cookie_secure, samesite="lax")


def current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    try:
        payload = _serializer().loads(token, max_age=MAX_AGE)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期") from None
    uid = payload.get("uid")
    user = row("SELECT * FROM users WHERE id=?", (uid,)) if uid else None
    if not user and payload.get("role") == "admin":
        user = row("SELECT * FROM users WHERE username='admin'")
    if not user or not user.get("enabled"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在或已停用")
    public = _public_user(user)
    if public["role"] not in ("admin", "owner") and not _route_allowed_for_user(public, request):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="权限不足：该账号没有管理权限")
    return public


def _route_allowed_for_user(user: dict, request: Request) -> bool:
    path = request.url.path
    method = request.method.upper()
    if path in ("/api/auth/change-password", "/api/profile"):
        return method in ("GET", "PATCH", "POST")
    if path == "/api/player/state":
        return method in ("GET", "PATCH")
    if path.startswith("/api/airplay/cast"):
        return method in ("GET", "POST", "PATCH", "DELETE") and "listen" in set(user.get("permissions") or [])
    if path in ("/api/dashboard", "/api/discovery/playlists", "/api/settings"):
        return method == "GET"
    if method == "GET" and (
        path.startswith("/api/library/")
        or path.startswith("/api/plex/items/")
        or path.startswith("/api/plex/image")
        or path.startswith("/api/player/")
        or path.startswith("/api/local/files")
        or path.startswith("/api/local/categories")
        or path.startswith("/api/local/artists/")
        or path.startswith("/api/catalog/search")
        or path.startswith("/api/catalog/unified")
        or path.startswith("/api/discovery/playlists/")
        or path.startswith("/api/downloads/device/")
        or path.startswith("/api/playlists")
        or path.startswith("/api/recommendations")
        or path.startswith("/api/listening")
    ):
        return True
    if method in ("POST", "PATCH", "DELETE") and (
        path.startswith("/api/playlists")
        or path.startswith("/api/recommendations")
        or path.startswith("/api/listening")
    ):
        return True
    if method == "POST" and path in ("/api/player/source-preview", "/api/downloads/device-token", "/api/profile/avatar"):
        return True
    permissions = set(user.get("permissions") or [])
    if "manage_library" in permissions and (
        path.startswith("/api/local/") or path.startswith("/api/plex/") or path.startswith("/api/scrape/") or path.startswith("/api/jobs") or path.startswith("/api/downloads")
    ):
        return True
    if "manage_sources" in permissions and path.startswith("/api/sources"):
        return True
    if "view_logs" in permissions and (path.startswith("/api/logs") or path.startswith("/api/backups")):
        return True
    return False


def change_password(user: dict, old_password: str, new_password: str):
    if len(new_password) < 10:
        raise HTTPException(status_code=400, detail="新密码至少需要 10 个字符")
    item = row("SELECT * FROM users WHERE id=?", (user["id"],))
    if not item:
        raise HTTPException(status_code=404, detail="账号不存在")
    encoded = item["password_hash"]
    if not verify_password(old_password, encoded):
        raise HTTPException(status_code=400, detail="当前密码错误")
    reset_password(user["id"], new_password)
    set_kv("session_secret", secrets.token_urlsafe(48))


def list_users():
    return [_public_user(item) for item in rows("SELECT * FROM users ORDER BY created_at")]


def create_user(username: str, password: str, display_name: str = "", role: str = "admin", permissions: list[str] | None = None, library_scopes: list[str] | None = None):
    username = _normalize_username(username)
    if len(password or "") < 10:
        raise HTTPException(status_code=400, detail="密码至少需要 10 个字符")
    role = role if role in ("admin", "owner", "library_admin", "listener") else "listener"
    stamp = now()
    user_id = secrets.token_hex(8)
    try:
        with transaction() as conn:
            conn.execute(
                """INSERT INTO users(id,username,display_name,password_hash,role,enabled,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (user_id, username, display_name.strip() or username, hash_password(password), role, 1, stamp, stamp),
            )
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            raise HTTPException(status_code=409, detail="用户名已存在") from exc
        raise
    if permissions is not None or library_scopes is not None:
        set_user_access(user_id, permissions or [], library_scopes or [])
    return _public_user(row("SELECT * FROM users WHERE id=?", (user_id,)))


def set_user_access(user_id: str, permissions: list[str], library_scopes: list[str]):
    if not row("SELECT id FROM users WHERE id=?", (user_id,)):
        raise HTTPException(status_code=404, detail="账号不存在")
    allowed = {"listen", "manage_library", "manage_sources", "manage_users", "view_logs"}
    clean_permissions = [value for value in dict.fromkeys(permissions) if value in allowed]
    if "listen" not in clean_permissions:
        clean_permissions.insert(0, "listen")
    clean_scopes = []
    for value in library_scopes:
        value = str(value or "").strip().strip("/")
        if value == "*" or (value and ".." not in value.split("/")):
            clean_scopes.append(value)
    access = get_kv("user_access", {}) or {}
    access[user_id] = {"permissions": clean_permissions, "libraryScopes": list(dict.fromkeys(clean_scopes))}
    set_kv("user_access", access)
    return _public_user(row("SELECT * FROM users WHERE id=?", (user_id,)))


def update_user(user_id: str, *, username: str | None = None, display_name: str | None = None, enabled: bool | None = None):
    current = row("SELECT * FROM users WHERE id=?", (user_id,))
    if not current:
        raise HTTPException(status_code=404, detail="账号不存在")
    next_username = _normalize_username(username) if username is not None else current["username"]
    next_display = (display_name.strip() if display_name is not None else current.get("display_name")) or next_username
    next_enabled = int(enabled if enabled is not None else current.get("enabled", 1))
    if current["username"] == "admin" and next_username != "admin":
        raise HTTPException(status_code=400, detail="内置 admin 账号不能改名，可新建其他管理员账号")
    if not next_enabled and _enabled_admin_count(exclude_id=user_id) <= 0:
        raise HTTPException(status_code=400, detail="至少需要保留一个启用的管理员账号")
    try:
        with transaction() as conn:
            conn.execute(
                "UPDATE users SET username=?,display_name=?,enabled=?,updated_at=? WHERE id=?",
                (next_username, next_display, next_enabled, now(), user_id),
            )
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            raise HTTPException(status_code=409, detail="用户名已存在") from exc
        raise
    return _public_user(row("SELECT * FROM users WHERE id=?", (user_id,)))


def reset_password(user_id: str, new_password: str):
    if len(new_password or "") < 10:
        raise HTTPException(status_code=400, detail="新密码至少需要 10 个字符")
    user = row("SELECT * FROM users WHERE id=?", (user_id,))
    if not user:
        raise HTTPException(status_code=404, detail="账号不存在")
    encoded = hash_password(new_password)
    with transaction() as conn:
        conn.execute("UPDATE users SET password_hash=?,updated_at=? WHERE id=?", (encoded, now(), user_id))
    if user["username"] == "admin":
        set_kv("password_hash", encoded)
    return True


def delete_user(user_id: str):
    user = row("SELECT * FROM users WHERE id=?", (user_id,))
    if not user:
        raise HTTPException(status_code=404, detail="账号不存在")
    if _enabled_admin_count(exclude_id=user_id) <= 0:
        raise HTTPException(status_code=400, detail="至少需要保留一个管理员账号")
    with transaction() as conn:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    access = get_kv("user_access", {}) or {}
    if user_id in access:
        del access[user_id]
        set_kv("user_access", access)
    return True


def reset_admin_from_env():
    if not settings.app_password:
        raise RuntimeError("APP_PASSWORD 未配置，无法重置 admin 密码")
    ensure_bootstrap_password()
    admin = row("SELECT * FROM users WHERE username='admin'") or row("SELECT * FROM users ORDER BY created_at LIMIT 1")
    if not admin:
        create_user("admin", settings.app_password, "管理员")
        return {"ok": True, "username": "admin", "created": True}
    reset_password(admin["id"], settings.app_password)
    update_user(admin["id"], enabled=True)
    return {"ok": True, "username": admin["username"], "reset": True}


def _enabled_admin_count(exclude_id: str | None = None) -> int:
    params = []
    clause = "WHERE role IN ('admin','owner') AND enabled=1"
    if exclude_id:
        clause += " AND id<>?"
        params.append(exclude_id)
    item = row(f"SELECT COUNT(*) AS count FROM users {clause}", tuple(params))
    return int(item["count"] if item else 0)
