#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"}
cd "$APP_DIR"
umask 077

if [ ! -f .env ]; then
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    SESSION_VALUE=$(openssl rand -hex 32)
  else
    SESSION_VALUE=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  fi
  python3 -c 'from pathlib import Path; import sys; p=Path(".env"); p.write_text(p.read_text().replace("replace-with-at-least-32-random-characters",sys.argv[1]))' "$SESSION_VALUE"
  chmod 600 .env
  echo "已创建受保护的 .env。首次访问时请在安装向导中创建管理员。"
fi

APP_UID=$(sed -n 's/^PUID=//p' .env | tail -1)
APP_GID=$(sed -n 's/^PGID=//p' .env | tail -1)
APP_UID=${APP_UID:-1000}
APP_GID=${APP_GID:-1000}
mkdir -p volumes/data volumes/downloads volumes/music volumes/library volumes/plex-config
chown -R "$APP_UID:$APP_GID" volumes/data volumes/downloads volumes/music 2>/dev/null || true

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "找不到 Docker Compose。"
  exit 1
fi

if [ -f volumes/data/manager.db ] && $COMPOSE ps -q songlib 2>/dev/null | grep -q .; then
  ./scripts/backup.sh
fi

$COMPOSE config --quiet
$COMPOSE pull
$COMPOSE up -d --remove-orphans

APP_PORT=$(sed -n 's/^APP_PORT=//p' .env | tail -1)
APP_PORT=${APP_PORT:-32782}
ready=0
attempt=1
while [ "$attempt" -le 50 ]; do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$APP_PORT/api/health/ready',timeout=3)" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 3
  attempt=$((attempt + 1))
done

if [ "$ready" -ne 1 ]; then
  echo "健康检查未通过。"
  $COMPOSE ps
  $COMPOSE logs --tail=120 songlib
  exit 1
fi

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "部署完成：http://${LAN_IP:-127.0.0.1}:$APP_PORT"
$COMPOSE ps
