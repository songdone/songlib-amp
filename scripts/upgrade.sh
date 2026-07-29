#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
./scripts/backup.sh
docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
