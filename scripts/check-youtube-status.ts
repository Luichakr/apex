/**
 * Проверка статуса загруженного видео на YouTube.
 * Запуск: node --env-file=.env --import tsx scripts/check-youtube-status.ts <videoId>
 */
import { google } from "googleapis";
import { prisma } from "../src/lib/db";
import { getDecryptedAccount } from "../src/lib/accounts";
import { youtubeProvider } from "../src/lib/providers/youtube";
import { getEnv } from "../src/lib/env";

async function main() {
  const videoId = process.argv[2];
  const acc = await prisma.socialAccount.findFirst({ where: { provider: "YOUTUBE" } });
  if (!acc) throw new Error("Нет YouTube-аккаунта");
  let dec = await getDecryptedAccount(acc.id);
  if (!dec) throw new Error("Не удалось расшифровать токен");
  dec = (await youtubeProvider.ensureFreshToken!(dec)) ?? dec;

  const env = getEnv();
  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ access_token: dec.accessToken });
  const youtube = google.youtube({ version: "v3", auth: client });

  const res = await youtube.videos.list({
    part: ["status", "snippet"],
    id: [videoId],
  });
  const v = res.data.items?.[0];
  console.log(JSON.stringify({
    id: videoId,
    title: v?.snippet?.title,
    privacyStatus: v?.status?.privacyStatus,
    uploadStatus: v?.status?.uploadStatus,
    rejectionReason: v?.status?.rejectionReason,
  }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
