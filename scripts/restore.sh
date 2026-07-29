#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "用法：./scripts/restore.sh songlib-YYYYMMDD-HHMMSS.db"
  exit 2
fi
case "$1" in
  songlib-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].db) ;;
  *) echo "备份文件名无效"; exit 2 ;;
esac
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose stop web worker
docker compose run --rm --no-deps web python -c 'from pathlib import Path; from datetime import datetime; import sqlite3,sys; source=Path("/data/backups")/sys.argv[1]; assert source.is_file(), "备份不存在"; check=sqlite3.connect(source); assert check.execute("PRAGMA integrity_check").fetchone()[0]=="ok", "备份损坏"; current=sqlite3.connect("/data/manager.db"); safety=sqlite3.connect(Path("/data/backups")/("pre-restore-"+datetime.now().strftime("%Y%m%d-%H%M%S")+".db")); current.backup(safety); safety.close(); check.backup(current); current.close(); check.close()' "$1"
docker compose up -d
