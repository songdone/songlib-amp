#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"}
cd "$APP_DIR"
mkdir -p data downloads deploy-backups

if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    APP_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)
    SESSION_SECRET=$(openssl rand -hex 32)
  else
    APP_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(18)[:20])')
    SESSION_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  fi
  umask 077
  {
    echo "APP_PASSWORD=$APP_PASSWORD"
    echo "SESSION_SECRET=$SESSION_SECRET"
  } > .env
  chmod 600 .env
  echo "SONGLIB_INITIAL_PASSWORD=$APP_PASSWORD"
else
  echo "SONGLIB_INITIAL_PASSWORD=UNCHANGED"
fi

if ! grep -q '^APP_PORT=' .env; then
  APP_PORT=$(python3 - <<'PY'
import socket
for port in range(32781, 32831):
    sock = socket.socket()
    try:
        sock.bind(('0.0.0.0', port))
    except OSError:
        continue
    finally:
        sock.close()
    print(port)
    break
else:
    raise SystemExit('没有找到可用端口')
PY
)
  echo "APP_PORT=$APP_PORT" >> .env
else
  APP_PORT=$(sed -n 's/^APP_PORT=//p' .env | tail -1)
fi
echo "SONGLIB_PORT=$APP_PORT"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "ERROR=找不到 docker compose"
  exit 1
fi

echo "SONGLIB_BUILD=starting"
$COMPOSE build --pull
echo "SONGLIB_START=starting"
$COMPOSE up -d --remove-orphans

ready=0
attempt=1
while [ "$attempt" -le 40 ]; do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$APP_PORT/api/health', timeout=3)" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 3
  attempt=$((attempt + 1))
done

if [ "$ready" -ne 1 ]; then
  echo "SONGLIB_HEALTH=failed"
  $COMPOSE ps
  $COMPOSE logs --tail=120
  exit 1
fi

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "SONGLIB_HEALTH=ok"
echo "SONGLIB_URL=http://${LAN_IP:-127.0.0.1}:$APP_PORT"
$COMPOSE ps
