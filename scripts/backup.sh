#!/usr/bin/env bash
# Резервная копия APX. Запуск:  bash scripts/backup.sh
#
# Сохраняет в папку backups/:
#   - дамп базы данных (пользователи, зашифрованные токены, посты);
#   - архив медиа (загруженные видео);
#   - копию .env (СОДЕРЖИТ КЛЮЧИ — храните в безопасном месте!).
#
# ВАЖНО: без TOKEN_ENCRYPTION_KEY из .env восстановить токены соцсетей нельзя.
# Поэтому .env так же важен для бэкапа, как и сама база.
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(date +%Y%m%d-%H%M%S)"
DIR="backups"
mkdir -p "$DIR"
chmod 700 "$DIR"

echo "==> Дамп базы данных…"
docker compose exec -T postgres sh -c 'pg_dump -U apex apex' \
  | gzip > "$DIR/db-$TS.sql.gz"

echo "==> Архив медиа…"
if docker compose exec -T app sh -c 'ls /app/media >/dev/null 2>&1'; then
  docker compose exec -T app sh -c 'tar czf - -C /app/media .' \
    > "$DIR/media-$TS.tgz" || echo "(медиа пусто или недоступно)"
fi

echo "==> Копия .env (с ключами)…"
if [ -f .env ]; then
  cp .env "$DIR/env-$TS.bak"
  chmod 600 "$DIR/env-$TS.bak"
fi

echo
echo "✅ Бэкап готов в папке $DIR:"
ls -lh "$DIR" | tail -n +2 | grep -E "$TS" || true
echo
echo "⚠️  Скопируйте бэкап на ДРУГОЙ носитель/облако. Файл env-*.bak содержит"
echo "    секретные ключи — храните его как пароль."
echo
echo "Автобэкап раз в сутки (пример для crontab -e):"
echo "  0 3 * * * cd $(pwd) && bash scripts/backup.sh >> backups/cron.log 2>&1"
