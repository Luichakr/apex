#!/usr/bin/env bash
# Поднимает всё нужное для APX на этом Mac и ничего не дублирует.
# Запуск: npm run up   (повторный запуск безопасен)
cd "$(dirname "$0")/.." || exit 1
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "База данных и очередь"
brew services start postgresql@16 >/dev/null 2>&1; ok "Postgres"
brew services start redis >/dev/null 2>&1; ok "Redis"

echo "Сайт (порт 3100)"
if ! lsof -ti :3100 >/dev/null 2>&1; then
  [ -d .next ] || npm run build >/tmp/apex-build.log 2>&1
  nohup npx next start -p 3100 >/tmp/apex-web.log 2>&1 &
  sleep 4
fi
lsof -ti :3100 >/dev/null 2>&1 && ok "Сайт работает" || warn "Сайт не запустился — смотрите /tmp/apex-web.log"

echo "Воркер (публикует видео, собирает охваты)"
if ! pgrep -f "tsx src/worker/index.ts" >/dev/null 2>&1; then
  nohup npm run worker >/tmp/apex-worker.log 2>&1 &
  sleep 5
fi
pgrep -f "tsx src/worker/index.ts" >/dev/null 2>&1 && ok "Воркер работает" || warn "Воркер не запустился — смотрите /tmp/apex-worker.log"

echo "Туннель"
if pgrep -f "cloudflared tunnel --url http://localhost:3100" >/dev/null 2>&1; then
  ok "Туннель работает"
else
  nohup cloudflared tunnel --url http://localhost:3100 >/tmp/apex-tunnel.log 2>&1 &
  sleep 8
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/apex-tunnel.log | head -1)
  warn "Туннель запущен заново, адрес мог измениться: ${URL:-не определён}"
  warn "Обновите APP_URL в .env и адреса возврата в кабинетах Google, Instagram, TikTok, LinkedIn"
fi
echo; npm run doctor 2>&1 | tail -4
