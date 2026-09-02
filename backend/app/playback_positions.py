"""Cross-device resume.

Listen to 3:20 on your phone, walk to the desk, and the browser offers to
pick up at 3:20.

Two rules that shape everything here:

1. **Never seek automatically.** The server stores a position; deciding to
   jump there is the user's. Auto-seeking is the kind of "smart" that feels
   like a bug the first time it surprises you mid-song.

2. **Positions near either end are not worth keeping.** A song stopped at
   0:04 was skipped, not interrupted; one stopped at 3 seconds from the end
   finished. Storing those means the resume list fills with noise and the
   one entry you actually wanted is pushed off the bottom.
"""

from __future__ import annotations

import json

from .db import now, row, rows, transaction

# 开头这些秒数内停下的，算"跳过了"，不记。
MIN_POSITION_SECONDS = 20.0
# 离结尾这么近的，算"听完了"，不记。
END_MARGIN_SECONDS = 25.0
# 一个用户最多留这么多条，超过的删最旧的。
MAX_ENTRIES_PER_USER = 60


def should_remember(position: float, duration: float) -> bool:
    """Is this position worth storing?

    Duration 0 means we do not know how long the track is (a stream, or a
    file whose tags never got read). In that case only the lower bound
    applies — we can still tell "barely started" from "well into it".
    """
    if position < MIN_POSITION_SECONDS:
        return False
    if duration and position > duration - END_MARGIN_SECONDS:
        return False
    return True


def save(user_id: str, payload: dict) -> dict:
    key = str(payload.get("trackKey") or "").strip()
    if not key:
        raise ValueError("缺少 trackKey")

    position = float(payload.get("position") or 0)
    duration = float(payload.get("duration") or 0)

    if not should_remember(position, duration):
        # 不值得记的位置要**删掉**已有记录，不是忽略。
        # 一首歌从头听到尾之后，上一次那个 3:20 就不该再留着 ——
        # 否则下次打开还会问你要不要从 3:20 继续。
        forget(user_id, key)
        return {"stored": False, "reason": "开头或结尾附近的位置不记"}

    track = payload.get("track") or {}
    with transaction() as conn:
        conn.execute(
            """INSERT INTO playback_positions
                 (user_id,track_key,position_seconds,duration_seconds,title,artist,
                  album,cover_url,track,device,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id,track_key) DO UPDATE SET
                 position_seconds=excluded.position_seconds,
                 duration_seconds=excluded.duration_seconds,
                 title=excluded.title, artist=excluded.artist, album=excluded.album,
                 cover_url=excluded.cover_url, track=excluded.track,
                 device=excluded.device, updated_at=excluded.updated_at""",
            (
                user_id, key, position, duration,
                str(payload.get("title") or ""), str(payload.get("artist") or ""),
                str(payload.get("album") or ""), str(payload.get("coverUrl") or ""),
                json.dumps(track, ensure_ascii=False),
                str(payload.get("device") or ""), now(),
            ),
        )
        conn.execute(
            """DELETE FROM playback_positions
               WHERE user_id=? AND track_key NOT IN (
                 SELECT track_key FROM playback_positions WHERE user_id=?
                 ORDER BY updated_at DESC LIMIT ?)""",
            (user_id, user_id, MAX_ENTRIES_PER_USER),
        )
    return {"stored": True, "position": position}


def forget(user_id: str, track_key: str) -> dict:
    with transaction() as conn:
        conn.execute(
            "DELETE FROM playback_positions WHERE user_id=? AND track_key=?",
            (user_id, track_key),
        )
    return {"ok": True}


def get(user_id: str, track_key: str) -> dict | None:
    record = row(
        "SELECT * FROM playback_positions WHERE user_id=? AND track_key=?",
        (user_id, track_key),
    )
    return _decode(record) if record else None


def recent(user_id: str, limit: int = 12) -> list[dict]:
    return [
        _decode(record)
        for record in rows(
            """SELECT * FROM playback_positions WHERE user_id=?
               ORDER BY updated_at DESC LIMIT ?""",
            (user_id, limit),
        )
    ]


def _decode(record: dict) -> dict:
    try:
        track = json.loads(record.get("track") or "{}")
    except (TypeError, ValueError):
        track = {}
    position = float(record.get("position_seconds") or 0)
    duration = float(record.get("duration_seconds") or 0)
    return {
        "trackKey": record["track_key"],
        "position": position,
        "duration": duration,
        # 百分比在服务端算，前端三处要用（继续听卡片、进度条、提示文案），
        # 各算各的迟早会有一处忘了除以 0。
        "progress": round(position / duration, 4) if duration else 0,
        "title": record.get("title") or "",
        "artist": record.get("artist") or "",
        "album": record.get("album") or "",
        "coverUrl": record.get("cover_url") or "",
        "device": record.get("device") or "",
        "updatedAt": record.get("updated_at"),
        "track": track,
    }
