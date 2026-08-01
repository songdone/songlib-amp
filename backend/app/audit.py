from __future__ import annotations

import json
import re
import uuid

from .db import now, rows, transaction


SENSITIVE_KEY = re.compile(r"(password|secret|token|cookie|authorization|api.?key)", re.IGNORECASE)


def redact(value):
    if isinstance(value, dict):
        return {key: ("[已保护]" if SENSITIVE_KEY.search(str(key)) else redact(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and len(value) > 500:
        return value[:500] + "…"
    return value


def record(actor_id: str | None, request_id: str | None, action: str, resource_type: str, resource_id: str | None, outcome: str, detail=None):
    with transaction() as conn:
        conn.execute(
            """INSERT INTO audit_events(id,actor_id,request_id,action,resource_type,resource_id,outcome,detail,created_at)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                uuid.uuid4().hex,
                actor_id,
                request_id,
                action,
                resource_type,
                resource_id,
                outcome,
                json.dumps(redact(detail or {}), ensure_ascii=False),
                now(),
            ),
        )


def list_events(limit: int = 100):
    items = rows("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 500)),))
    for item in items:
        try:
            item["detail"] = json.loads(item.get("detail") or "{}")
        except json.JSONDecodeError:
            item["detail"] = {}
    return items
