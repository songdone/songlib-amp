FROM --platform=$BUILDPLATFORM node:24.14.0-alpine3.23 AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN npm install --global pnpm@11.9.0 --ignore-scripts --no-audit --no-fund \
    && pnpm install --frozen-lockfile --ignore-scripts
COPY frontend/ ./
RUN npm run build

FROM python:3.12.10-slim-bookworm AS runtime
ARG APP_UID=10001
ARG APP_GID=10001
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATA_DIR=/data \
    MUSIC_ROOT=/music \
    DOWNLOAD_ROOT=/downloads \
    PLEX_CONFIG=/plex-config \
    STATIC_DIR=/app/static \
    PORT=8080
RUN apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Timeout=20 update \
    && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::http::Timeout=20 install -y --no-install-recommends nodejs tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${APP_GID}" songlib \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --home-dir /app --no-create-home --shell /usr/sbin/nologin songlib
WORKDIR /app
COPY backend/requirements.txt backend/requirements.lock ./
RUN pip install -r requirements.lock
COPY --chown=songlib:songlib backend/app ./app
COPY --chown=songlib:songlib backend/lx_bridge.mjs backend/source_inspector.mjs ./
COPY --from=frontend --chown=songlib:songlib /build/frontend/dist ./static
RUN find /app -type d -exec chmod 755 {} + \
    && find /app -type f -exec chmod 644 {} + \
    && mkdir -p /data /music /downloads /plex-config \
    && chown -R songlib:songlib /data /music /downloads /plex-config /app
USER songlib
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health/ready',timeout=3)"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips=${FORWARDED_ALLOW_IPS:-127.0.0.1}"]
