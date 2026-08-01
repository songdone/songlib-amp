#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"}
cd "$APP_DIR"
umask 077

APP_UID=${APP_UID:-1000}
APP_GID=${APP_GID:-1000}
mkdir -p data downloads music
chown -R "$APP_UID:$APP_GID" data downloads music 2>/dev/null || true

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "找不到 Docker Compose。"
  exit 1
fi

if [ -f data/manager.db ] && $COMPOSE ps -q songlib 2>/dev/null | grep -q .; then
  ./scripts/backup.sh
fi

$COMPOSE config --quiet
$COMPOSE pull
$COMPOSE up -d --remove-orphans

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
