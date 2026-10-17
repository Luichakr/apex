# ---- Базовый образ с зависимостями --------------------------------------
FROM node:20-slim AS base
# openssl нужен Prisma; ca-certificates — HTTPS к API; ffmpeg — конвертация видео в H.264
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Установка зависимостей ---------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

# ---- Сборка Next.js ------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Финальный рантайм ---------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Приносим всё приложение (не используем standalone, чтобы тем же образом
# запускать и веб, и воркер, и prisma-команды одной командой).
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
