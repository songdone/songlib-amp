from __future__ import annotations

import json
import re
import unicodedata
import uuid
from collections import Counter

from fastapi import HTTPException

from .db import now, row, rows, transaction


EVENT_TYPES = {"start", "progress", "complete", "skip", "replay", "favorite", "unfavorite"}
VERSION_MARKERS = re.compile(r"\b(live|dj|remix|instrumental|karaoke|cover)\b|现场|伴奏|翻唱|混音", re.IGNORECASE)


def _norm(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)


def record_event(user_id: str, event_type: str, file_id: str | None, external_ref: str | None, position_ms: int, duration_ms: int, context: dict):
    if event_type not in EVENT_TYPES:
        raise HTTPException(status_code=400, detail="不支持的播放事件")
    if not file_id and not external_ref:
        raise HTTPException(status_code=400, detail="播放事件缺少歌曲标识")
    if file_id and not row("SELECT id FROM files WHERE id=?", (file_id,)):
        raise HTTPException(status_code=404, detail="歌曲不存在")
    event_id = uuid.uuid4().hex
    with transaction() as conn:
        conn.execute(
            """INSERT INTO listening_events(
                 id,user_id,file_id,external_ref,event_type,position_ms,duration_ms,context,created_at
               ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                event_id,
                user_id,
                file_id,
                (external_ref or "")[:500] or None,
                event_type,
                max(0, int(position_ms or 0)),
                max(0, int(duration_ms or 0)),
                json.dumps(context or {}, ensure_ascii=False),
                now(),
            ),
        )
    return {"id": event_id, "recorded": True}


def build_profile(user_id: str):
    events = rows(
        """SELECT e.event_type,e.position_ms,e.duration_ms,f.artist,f.album,f.genre,f.year
           FROM listening_events e LEFT JOIN files f ON f.id=e.file_id
           WHERE e.user_id=? ORDER BY e.created_at DESC LIMIT 10000""",
        (user_id,),
    )
    weights = {"complete": 3.0, "replay": 4.0, "favorite": 5.0, "start": 0.4, "progress": 0.5, "skip": -2.5, "unfavorite": -4.0}
    artists: Counter = Counter()
    genres: Counter = Counter()
    decades: Counter = Counter()
    completed = skipped = 0
    for item in events:
        weight = weights.get(item["event_type"], 0)
        if item.get("artist"):
            artists[item["artist"]] += weight
        if item.get("genre"):
            for genre in str(item["genre"]).split(";"):
                if genre.strip():
                    genres[genre.strip()] += weight
        year = str(item.get("year") or "")[:4]
        if year.isdigit():
            decades[f"{int(year) // 10 * 10}s"] += max(0.2, weight)
        completed += item["event_type"] == "complete"
        skipped += item["event_type"] == "skip"
    meaningful = max(1, completed + skipped)
    profile = {
        "topArtists": [{"name": key, "score": round(value, 2)} for key, value in artists.most_common(8) if value > 0],
        "topGenres": [{"name": key, "score": round(value, 2)} for key, value in genres.most_common(8) if value > 0],
        "favoriteDecades": [{"name": key, "score": round(value, 2)} for key, value in decades.most_common(5)],
        "completionRate": round(completed / meaningful, 3),
        "skipRate": round(skipped / meaningful, 3),
        "privacy": "local",
        "explanation": "画像仅由此设备保存的播放、完成、跳过和收藏事件生成。",
    }
    with transaction() as conn:
        conn.execute(
            """INSERT INTO recommendation_profiles(user_id,profile,event_count,generated_at)
               VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
               profile=excluded.profile,event_count=excluded.event_count,generated_at=excluded.generated_at""",
            (user_id, json.dumps(profile, ensure_ascii=False), len(events), now()),
        )
    return {"profile": profile, "eventCount": len(events), "generatedAt": now()}


def refresh(user_id: str, discoveries: list[dict] | None = None, exploration: float = 0.35):
    profile_data = build_profile(user_id)
    profile = profile_data["profile"]
    exploration = max(0.0, min(1.0, float(exploration)))
    top_artists = {item["name"].casefold(): item["score"] for item in profile["topArtists"]}
    recently_played = {
        item["file_id"]
        for item in rows(
            "SELECT DISTINCT file_id FROM listening_events WHERE user_id=? AND file_id IS NOT NULL ORDER BY created_at DESC LIMIT 300",
            (user_id,),
        )
    }
    candidates: list[dict] = []
    for item in rows("SELECT id,title,artist,album,duration,genre,year FROM files ORDER BY updated_at DESC LIMIT 3000"):
        familiarity = max([score for artist, score in top_artists.items() if artist and artist in str(item.get("artist") or "").casefold()] or [0])
        if item["id"] in recently_played:
            familiarity -= 2
        candidates.append(
            {
                **item,
                "externalRef": f"local:{item['id']}",
                "inLibrary": True,
                "score": round((1 - exploration) * familiarity + exploration * 1.5, 3),
                "reasons": ["你常听的音乐人"] if familiarity > 0 else ["从音乐库中探索"],
            }
        )
    library_keys = {(_norm(item["title"]), _norm(item["artist"])) for item in rows("SELECT title,artist FROM files")}
    for item in discoveries or []:
        title = str(item.get("title") or "").strip()
        artist = str(item.get("artist") or "").strip()
        if not title or not artist or VERSION_MARKERS.search(title):
            continue
        duration_ms = int(item.get("durationMs") or item.get("duration") or 0)
        if not 30_000 <= duration_ms <= 30 * 60 * 1000:
            continue
        if (_norm(title), _norm(artist)) in library_keys:
            continue
        candidates.append(
            {
                "id": uuid.uuid4().hex,
                "title": title,
                "artist": artist,
                "album": str(item.get("album") or ""),
                "duration": duration_ms,
                "externalRef": str(item.get("externalRef") or item.get("id") or "")[:500] or None,
                "inLibrary": False,
                "score": round(3.5 + exploration * 4, 3),
                "reasons": ["库外探索", "来自已启用的目录提供方"],
            }
        )
    candidates.sort(key=lambda item: item["score"], reverse=True)
    selected = candidates[:100]
    stamp = now()
    with transaction() as conn:
        conn.execute("DELETE FROM recommendation_candidates WHERE user_id=?", (user_id,))
        for item in selected:
            conn.execute(
                """INSERT INTO recommendation_candidates(
                     id,user_id,title,artist,album,duration_ms,external_ref,in_library,score,reasons,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    uuid.uuid4().hex,
                    user_id,
                    item["title"],
                    item["artist"],
                    item.get("album") or "",
                    int(item.get("duration") or 0),
                    item.get("externalRef"),
                    int(item["inLibrary"]),
                    item["score"],
                    json.dumps(item["reasons"], ensure_ascii=False),
                    stamp,
                ),
            )
    return list_recommendations(user_id)


def list_recommendations(user_id: str):
    profile_item = row("SELECT * FROM recommendation_profiles WHERE user_id=?", (user_id,))
    if not profile_item:
        build_profile(user_id)
        profile_item = row("SELECT * FROM recommendation_profiles WHERE user_id=?", (user_id,))
    items = rows("SELECT * FROM recommendation_candidates WHERE user_id=? ORDER BY score DESC LIMIT 100", (user_id,))
    for item in items:
        item["inLibrary"] = bool(item.pop("in_library"))
        try:
            item["reasons"] = json.loads(item.get("reasons") or "[]")
        except json.JSONDecodeError:
            item["reasons"] = []
    return {
        "profile": json.loads(profile_item["profile"] or "{}"),
        "eventCount": profile_item["event_count"],
        "generatedAt": profile_item["generated_at"],
        "items": items,
    }
