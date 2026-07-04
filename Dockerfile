FROM docker.m.daocloud.io/library/python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    MUSIC_ROOT=/music \
    PLEX_CONFIG=/plex-config \
    PORT=32781
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/lx_bridge.mjs ./lx_bridge.mjs
COPY backend/source_inspector.mjs ./source_inspector.mjs
COPY frontend/dist ./static
RUN mkdir -p /data /music /plex-config
EXPOSE 32781
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','32781')+'/api/health', timeout=3)"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
