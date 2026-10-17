#!/usr/bin/env bash
# Установка Docker на чистый сервер Ubuntu/Debian.
# Запуск (на сервере, один раз):  sudo bash scripts/install-docker.sh
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  echo "Docker уже установлен: $(docker --version)"
  exit 0
fi

echo "==> Устанавливаю Docker…"
apt-get update -y
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> Готово: $(docker --version)"
echo "Теперь выполните: bash scripts/deploy.sh"
