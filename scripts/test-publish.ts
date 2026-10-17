/**
 * Универсальная тестовая постановка публикации.
 * Запуск: node --env-file=.env --import tsx scripts/test-publish.ts <PROVIDER> <путь> [подпись]
 * PROVIDER: YOUTUBE | TIKTOK | FACEBOOK | INSTAGRAM
 */
import { resolve } from "node:path";
import { statSync } from "node:fs";
import type { Provider } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { publishQueue } from "../src/lib/redis";

async function main() {
  const provider = (process.argv[2] || "").toUpperCase() as Provider;
  const file = resolve(process.argv[3] || "media/test-tiktok.mp4");
  const caption = process.argv[4] || "Тест APEX";
  const size = statSync(file).size;
  const ext = file.toLowerCase().split(".").pop();
  const mediaType =
    ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";

  const account = await prisma.socialAccount.findFirst({ where: { provider } });
  if (!account) throw new Error(`Нет подключённого аккаунта ${provider}`);

  const post = await prisma.post.create({
    data: {
      userId: account.userId,
      caption,
      mediaPath: file,
      mediaType,
      mediaSize: size,
      status: "PUBLISHING",
      targets: { create: [{ socialAccountId: account.id, provider, status: "QUEUED" }] },
    },
    include: { targets: true },
  });

  for (const t of post.targets) {
    await publishQueue.add(
      "publish",
      { targetId: t.id },
      { attempts: 2, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true }
    );
  }
  console.log(`Поставлено: provider=${provider}, post=${post.id}, target=${post.targets[0].id}, аккаунт=${account.displayName}`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
