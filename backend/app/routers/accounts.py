"""首装、登录会话与账号管理。

首装只在没有任何账号时可用；登录带速率限制，成功后签发 CSRF。
账号的增删改都要求调用方已登录，具体角色校验在 auth 模块里。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import audit
from .. import auth
from ..config import settings
from ..security import client_key
from ..security import issue_csrf
from ..security import rate_limiter
from ..schemas import ChangePasswordBody, LoginBody, SetupBody, UserCreateBody, UserPasswordBody, UserUpdateBody

router = APIRouter(prefix="/api", tags=["accounts"])


@router.get("/setup/status")
def setup_status():
    return {
        "required": auth.setup_required(),
        "version": settings.app_version,
        "checks": _health_checks(),
    }


@router.post("/setup/complete")
def complete_setup(body: SetupBody, request: Request, response: Response):
    rate_limiter.check(client_key(request, "setup"), limit=5, window_seconds=900)
    user = auth.complete_setup(body.username, body.password, body.displayName)
    auth.login(response, body.password, body.username)
    audit.record(user["id"], request.state.request_id, "setup.complete", "installation", None, "success")
    return {"ok": True, "user": user}


@router.get("/auth/status")
def auth_status(request: Request, response: Response):
    try:
        user = auth.current_user(request)
        authenticated = True
        if not request.cookies.get("songlib_csrf"):
            issue_csrf(response)
    except HTTPException:
        user = None
        authenticated = False
    return {"authenticated": authenticated, "setupRequired": auth.setup_required(), "user": user}


@router.post("/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    if auth.setup_required():
        raise HTTPException(status_code=409, detail="请先完成初始设置")
    key = client_key(request, "login")
    rate_limiter.check(key, limit=8, window_seconds=900)
    try:
        user = auth.login(response, body.password, body.username)
    except HTTPException:
        audit.record(None, request.state.request_id, "auth.login", "session", None, "denied", {"username": body.username})
        raise
    audit.record(user["id"], request.state.request_id, "auth.login", "session", None, "success")
    return {"ok": True, "user": user}


@router.post("/auth/logout")
def logout(response: Response):
    auth.logout(response)
    return {"ok": True}


@router.post("/auth/change-password")
def change_password(body: ChangePasswordBody, response: Response, user=Depends(auth.current_user)):
    auth.change_password(user, body.currentPassword, body.newPassword)
    auth.logout(response)
    return {"ok": True}


@router.get("/users", dependencies=[Depends(auth.current_user)])
def users():
    return {"items": auth.list_users()}


@router.post("/users", dependencies=[Depends(auth.current_user)])
def create_user(body: UserCreateBody):
    return auth.create_user(body.username, body.password, body.displayName, body.role, body.permissions, body.libraryScopes)


@router.patch("/users/{user_id}", dependencies=[Depends(auth.current_user)])
def update_user(user_id: str, body: UserUpdateBody):
    result = auth.update_user(user_id, username=body.username, display_name=body.displayName, enabled=body.enabled)
    if body.permissions is not None or body.libraryScopes is not None:
        result = auth.set_user_access(user_id, body.permissions or result.get("permissions") or [], body.libraryScopes or result.get("libraryScopes") or [])
    return result


@router.post("/users/{user_id}/password", dependencies=[Depends(auth.current_user)])
def reset_user_password(user_id: str, body: UserPasswordBody):
    auth.reset_password(user_id, body.password)
    return {"ok": True}


@router.delete("/users/{user_id}", dependencies=[Depends(auth.current_user)])
def delete_user(user_id: str):
    auth.delete_user(user_id)
    return {"ok": True}
