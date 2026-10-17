#!/usr/bin/env bash
# Развёртывание APEX. Запуск из папки проекта:  bash scripts/deploy.sh
#
# Что делает:
#  1) проверяет, что .env создан и заполнены критичные секреты;
#  2) собирает и запускает все контейнеры (app, worker, postgres, redis, caddy);
#  3) схема БД синхронизируется автоматически при старте app.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Проверяю окружение…"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker не установлен. Сначала выполните: sudo bash scripts/install-docker.sh"
  exit 1
fi

if [ ! -f .env ]; then
  echo "❌ Файл .env не найден."
  echo "   Скопируйте образец и заполните:  cp .env.example .env"
  echo "   Затем сгенерируйте ключи:        docker compose run --rm app npm run keygen"
  exit 1
fi

# Проверяем, что ключи заданы (не пустые).
missing=0
for key in TOKEN_ENCRYPTION_KEY SESSION_SECRET MAGIC_LINK_SECRET APP_URL APP_DOMAIN; do
  val="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)"
  if [ -z "$val" ]; then
    echo "❌ В .env не заполнено: ${key}"
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  echo
  echo "Подсказка: сгенерировать секреты можно так:"
  echo "  docker compose run --rm app npm run keygen"
  echo "и вставить три строки в .env."
  exit 1
fi

echo "==> Собираю и запускаю контейнеры…"
docker compose up -d --build

echo "==> Статус:"
docker compose ps

echo
echo "✅ Готово. Приложение поднимается."
echo "   Откройте в браузере:  $(grep -E '^APP_URL=' .env | cut -d= -f2-)"
echo "   Логи приложения:      docker compose logs -f app"
echo "   Логи воркера:         docker compose logs -f worker"
