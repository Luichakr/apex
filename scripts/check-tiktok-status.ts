/**
 * Проверка статуса загрузки в TikTok по publish_id.
 * Запуск: node --env-file=.env --import tsx scripts/check-tiktok-status.ts <publish_id>
 */
import { prisma } from "../src/lib/db";
import { getDecryptedAccount } from "../src/lib/accounts";
import { tiktokProvider } from "../src/lib/providers/tiktok";

async function main() {
  const publishId = process.argv[2];
  if (!publishId) throw new Error("Укажите publish_id");

  const acc = await prisma.socialAccount.findFirst({ where: { provider: "TIKTOK" } });
  if (!acc) throw new Error("Нет TikTok-аккаунта");
  let dec = await getDecryptedAccount(acc.id);
  if (!dec) throw new Error("Не удалось расшифровать токен");
  dec = (await tiktokProvider.ensureFreshToken!(dec)) ?? dec;

  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dec.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    }
  );
  const json = await res.json();
  console.log("HTTP", res.status);
  console.log(JSON.stringify(json, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
