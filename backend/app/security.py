from __future__ import annotations

import hmac
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from .config import settings


SESSION_COOKIE = "songlib_session"
CSRF_COOKIE = "songlib_csrf"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/setup/complete",
}


class RateLimiter:
    def __init__(self):
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, *, limit: int, window_seconds: int) -> None:
        timestamp = time.monotonic()
        with self._lock:
            events = self._events[key]
            threshold = timestamp - window_seconds
            while events and events[0] < threshold:
                events.popleft()
            if len(events) >= limit:
                retry_after = max(1, int(window_seconds - (timestamp - events[0])))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="尝试次数过多，请稍后再试",
                    headers={"Retry-After": str(retry_after)},
                )
            events.append(timestamp)


rate_limiter = RateLimiter()


def client_key(request: Request, scope: str) -> str:
    address = request.client.host if request.client else "unknown"
    return f"{scope}:{address}"


def issue_csrf(response) -> str:
    token = secrets.token_urlsafe(32)
    response.set_cookie(
        CSRF_COOKIE,
        token,
        max_age=60 * 60 * 24 * 14,
        httponly=False,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return token


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id", "")[:100] or uuid.uuid4().hex
        request.state.request_id = request_id

        host = request.headers.get("host", "").split(":", 1)[0].casefold()
        if settings.trusted_hosts and host not in {item.casefold() for item in settings.trusted_hosts}:
            return JSONResponse(status_code=400, content={"detail": "请求主机不受信任"})

        origin = request.headers.get("origin", "").rstrip("/")
        public_airplay_stream = request.url.path.startswith("/api/airplay/stream/")
        if origin and not public_airplay_stream and not self._origin_allowed(request, origin):
            return JSONResponse(status_code=403, content={"detail": "请求来源不受信任"})
        if request.method.upper() == "OPTIONS" and origin:
            response = Response(status_code=204)
            self._cors_headers(response, origin)
            response.headers["X-Request-ID"] = request_id
            return response

        if (
            request.url.path.startswith("/api/")
            and request.method.upper() not in SAFE_METHODS
            and request.url.path not in CSRF_EXEMPT_PATHS
            and request.cookies.get(SESSION_COOKIE)
        ):
            cookie_token = request.cookies.get(CSRF_COOKIE, "")
            header_token = request.headers.get("x-csrf-token", "")
            if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
                return JSONResponse(status_code=403, content={"detail": "安全令牌无效，请刷新页面后重试"})

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        airplay_origin = ""
        if settings.airplay_public_base_url:
            parsed = urlparse(settings.airplay_public_base_url)
            airplay_origin = f" {parsed.scheme}://{parsed.netloc}"
        response.headers["Content-Security-Policy"] = (
            f"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:{airplay_origin}; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
        )
        if origin and origin in settings.trusted_origins:
            self._cors_headers(response, origin)
        return response

    @staticmethod
    def _origin_allowed(request: Request, origin: str) -> bool:
        """同源请求要放过，跨源请求要拦住。

        这里踩过一次线上事故。原来预期来源是

            f"{request.url.scheme}://{host}"

        应用跑在 HTTPS 反代后面时，uvicorn 看到的是反代过来的内网 HTTP，
        scheme 是 http；而浏览器发的 Origin 是 https://<域名>。两者对不上，
        于是**自己的静态资源被自己拦成 403**，整站白屏。

        为什么以前没炸：Vite 会给 module script 加 crossorigin，这些请求
        才带 Origin；而 Service Worker 把资源缓存住了，根本不走网络。
        等到发版换了资源指纹和缓存版本，浏览器必须回源，才一次性暴露。

        --proxy-headers 解决不了：它只信 --forwarded-allow-ips 里的地址，
        而反代通常不在 127.0.0.1。把那个改成 * 是更大的授权，不划算。

        所以这里只放宽一件事：host 仍然必须完全相同，scheme 额外接受
        https。方向是安全的 —— 攻击者无法伪造 Origin，host 又必须一致，
        放宽的只是"反代在外面把 http 升成了 https"这一种情形。
        反过来（对外 https、Origin 写 http）不在放宽范围里。
        """
        if origin in settings.trusted_origins:
            return True
        host = request.headers.get("host", "")
        # 用 any + compare_digest 而不是 in，保持原来的定时安全比较风格。
        return any(
            hmac.compare_digest(origin, f"{scheme}://{host}".rstrip("/"))
            for scheme in {request.url.scheme, "https"}
        )

    @staticmethod
    def _cors_headers(response, origin: str) -> None:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,DELETE,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,X-CSRF-Token,X-Request-ID"
        response.headers["Vary"] = "Origin"
