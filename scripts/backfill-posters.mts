/** Разовая миграция: обложки и метаданные для постов, созданных до редизайна. */
import { stat } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { makePoster, probeMedia } from "../src/lib/video";

const posts = await prisma.post.findMany({ where: { mediaDeletedAt: null } });
for (const p of posts) {
  if (!(await stat(p.mediaPath).catch(() => null))) continue;
  const info = await probeMedia(p.mediaPath).catch(() => null);
  if (!info) continue;
  await makePoster(p.mediaPath, info);
  if (!p.mediaMeta) {
    await prisma.post.update({ where: { id: p.id }, data: { mediaMeta: info as unknown as Prisma.InputJsonValue } });
  }
  console.log("ok", p.id);
}
// TikTok inbox-загрузки до появления флага isDraft.
const n = await prisma.postTarget.updateMany({
  where: { provider: "TIKTOK", status: "DONE", externalUrl: null, isDraft: false },
  data: { isDraft: true },
});
console.log("tiktok drafts marked:", n.count);
await prisma.$disconnect();
