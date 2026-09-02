"""播放事件、本地推荐画像与审计记录。

三者放在一起是因为它们共享同一条数据链路：播放事件写入 listening_events，
推荐从中聚合画像，审计记录管理操作。完整播放历史只留在本地。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import audit
from .. import auth
from .. import recommendations as recommendation_service
from ..schemas import ListeningEventBody, RecommendationRefreshBody

router = APIRouter(prefix="/api", tags=["insights"])


@router.post("/listening/events")
def listening_event(body: ListeningEventBody, user=Depends(auth.current_user)):
    return recommendation_service.record_event(
        user["id"],
        body.eventType,
        body.fileId,
        body.externalRef,
        body.positionMs,
        body.durationMs,
        body.context,
    )


@router.get("/recommendations")
def recommendations(user=Depends(auth.current_user)):
    return recommendation_service.list_recommendations(user["id"])


@router.post("/recommendations/refresh")
def refresh_recommendations(body: RecommendationRefreshBody, request: Request, user=Depends(auth.current_user)):
    result = recommendation_service.refresh(user["id"], body.discoveries, body.exploration)
    audit.record(
        user["id"],
        request.state.request_id,
        "recommendation.refresh",
        "profile",
        user["id"],
        "success",
        {"candidateCount": len(result["items"]), "exploration": body.exploration},
    )
    return result


@router.get("/audit/events")
def audit_events(limit: int = Query(default=100, ge=1, le=500), user=Depends(auth.current_user)):
    if user["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="只有管理员可以查看审计记录")
    return {"items": audit.list_events(limit)}
