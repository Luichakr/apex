/**
 * Прямая отправка видео в черновики/уведомления TikTok (inbox), без очереди.
 * Запуск: node --env-file=.env --import tsx scripts/test-tiktok-direct.ts [путь] [подпись]
 */
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { getDecryptedAccount } from "../src/lib/accounts";
import { tiktokProvider } from "../src/lib/providers/tiktok";

async function main() {
  const file = resolve(process.argv[2] || "media/ig-test.mp4");
  const caption = process.argv[3] || "Тест APEX → TikTok";

  const acc = await prisma.socialAccount.findFirst({ where: { provider: "TIKTOK" } });
  if (!acc) throw new Error("Нет подключённого TikTok");
  let dec = await getDecryptedAccount(acc.id);
  if (!dec) throw new Error("Не удалось расшифровать токен");
  dec = (await tiktokProvider.ensureFreshToken!(dec)) ?? dec;

  console.log("Аккаунт:", dec.displayName, "| файл:", file);
  const res = await tiktokProvider.publish(dec, {
    filePath: file,
    mimeType: "video/mp4",
    caption,
  });
  console.log("Отправлено в TikTok inbox, publish_id:", res.externalId);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("ОШИБКА:", e?.message || e); process.exit(1); });
