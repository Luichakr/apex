/**
 * Тестовая постановка публикации в TikTok (черновик) для проверки воркера.
 * Запуск: node --env-file=.env --import tsx scripts/test-publish-tiktok.ts <путь_к_видео> [подпись]
 */
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { publishQueue } from "../src/lib/redis";

async function main() {
  const file = resolve(process.argv[2] || "media/test-tiktok.mp4");
  const caption =
    process.argv[3] || "Тестовая загрузка из APEX (черновик TikTok)";
  const size = statSync(file).size;
  const ext = file.toLowerCase().split(".").pop();
  const mediaType =
    ext === "mov"
      ? "video/quicktime"
      : ext === "webm"
        ? "video/webm"
        : "video/mp4";

  const account = await prisma.socialAccount.findFirst({
    where: { provider: "TIKTOK" },
  });
  if (!account) throw new Error("Нет подключённого TikTok-аккаунта");

  const post = await prisma.post.create({
    data: {
      userId: account.userId,
      caption,
      mediaPath: file,
      mediaType,
      mediaSize: size,
      status: "PUBLISHING",
      targets: {
        create: [
          {
            socialAccountId: account.id,
            provider: "TIKTOK",
            status: "QUEUED",
          },
        ],
      },
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

  console.log(
    `Поставлено в очередь: post=${post.id}, target=${post.targets[0].id}, аккаунт=${account.displayName}`
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
