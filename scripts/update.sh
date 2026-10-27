#!/usr/bin/env bash
# Обновление APX до новой версии кода. Запуск:  bash scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Делаю резервную копию перед обновлением…"
bash scripts/backup.sh || echo "(бэкап пропущен)"

if [ -d .git ]; then
  echo "==> Забираю свежий код…"
  git pull --ff-only
fi

echo "==> Пересобираю и перезапускаю…"
docker compose up -d --build

echo "✅ Обновление завершено."
docker compose ps
