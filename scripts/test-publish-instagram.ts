/**
 * Тестовая публикация в Instagram: История (STORIES) и пост в ленту (REELS).
 * Только Instagram. Запуск:
 *   node --env-file=.env --import tsx scripts/test-publish-instagram.ts [путь] [подпись]
 */
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { getDecryptedAccount } from "../src/lib/accounts";
import { instagramProvider } from "../src/lib/providers/instagram";
import { publicMediaUrl } from "../src/lib/media";

const GRAPH = "https://graph.instagram.com/v21.0";

async function igPost(
  igUserId: string,
  token: string,
  body: Record<string, string>
): Promise<string> {
  // 1. Создать контейнер
  const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
    cache: "no-store",
  });
  const created = await createRes.json();
  if (!createRes.ok || created.error) {
    throw new Error(`create(${body.media_type}): ${created.error?.message ?? createRes.statusText}`);
  }
  const creationId = String(created.id);

  // 2. Дождаться обработки
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const s = await (
      await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${token}`, { cache: "no-store" })
    ).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
      throw new Error(`container ${body.media_type}: статус ${s.status_code}`);
    if (Date.now() > deadline) throw new Error(`container ${body.media_type}: таймаут`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 3. Опубликовать
  const pubRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
    cache: "no-store",
  });
  const published = await pubRes.json();
  if (!pubRes.ok || published.error) {
    throw new Error(`publish(${body.media_type}): ${published.error?.message ?? pubRes.statusText}`);
  }
  return String(published.id);
}

async function permalink(mediaId: string, token: string): Promise<string | undefined> {
  try {
    const info = await (
      await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${token}`, { cache: "no-store" })
    ).json();
    return info.permalink;
  } catch {
    return undefined;
  }
}

async function main() {
  const file = resolve(process.argv[2] || "media/ig-test.mp4");
  const caption = process.argv[3] || "Тест APEX → Instagram 🎬";

  const acc = await prisma.socialAccount.findFirst({ where: { provider: "INSTAGRAM" } });
  if (!acc) throw new Error("Нет подключённого Instagram");
  let dec = await getDecryptedAccount(acc.id);
  if (!dec) throw new Error("Не удалось расшифровать токен");
  dec = (await instagramProvider.ensureFreshToken!(dec)) ?? dec;

  // Правильный id для публикации берём из /me (user_id), а не из токена.
  const me = await (
    await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${dec.accessToken}`, { cache: "no-store" })
  ).json();
  const igUserId = String(me.user_id ?? dec.meta?.igUserId ?? dec.providerAccountId);
  const videoUrl = publicMediaUrl(file);
  console.log("Аккаунт:", dec.displayName, "| видео:", videoUrl);

  console.log("→ Публикую Историю (STORIES)…");
  const storyId = await igPost(igUserId, dec.accessToken, {
    media_type: "STORIES",
    video_url: videoUrl,
  });
  console.log("  Story опубликована, media id:", storyId);

  console.log("→ Публикую пост в ленту (REELS)…");
  const reelId = await igPost(igUserId, dec.accessToken, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
  });
  const reelUrl = await permalink(reelId, dec.accessToken);
  console.log("  Пост опубликован, media id:", reelId, "ссылка:", reelUrl ?? "(нет)");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e?.message || e);
  process.exit(1);
});
