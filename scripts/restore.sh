#!/usr/bin/env bash
# Восстановление базы из бэкапа.
# Запуск:  bash scripts/restore.sh backups/db-ГГГГММДД-ЧЧММСС.sql.gz
#
# ВНИМАНИЕ: перезапишет текущую базу. Токены расшифруются только если в .env
# тот же TOKEN_ENCRYPTION_KEY, что был на момент бэкапа.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Укажите файл дампа. Пример:"
  echo "  bash scripts/restore.sh backups/db-20260101-030000.sql.gz"
  exit 1
fi

read -r -p "Это перезапишет текущую базу. Продолжить? (yes/no) " ans
[ "$ans" = "yes" ] || { echo "Отменено."; exit 0; }

echo "==> Восстанавливаю базу из $FILE…"
gunzip -c "$FILE" | docker compose exec -T postgres sh -c 'psql -U apex -d apex'

echo "✅ Восстановление завершено. Перезапустите приложение: docker compose restart app worker"
