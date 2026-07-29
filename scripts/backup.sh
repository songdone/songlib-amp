#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p volumes/data/backups
docker compose exec -T songlib python -c 'from app.db import connect; from pathlib import Path; from datetime import datetime; import sqlite3; target=Path("/data/backups")/("songlib-"+datetime.now().strftime("%Y%m%d-%H%M%S")+".db"); source=connect(); destination=sqlite3.connect(target); source.backup(destination); destination.close(); source.close(); print(target.name)'
