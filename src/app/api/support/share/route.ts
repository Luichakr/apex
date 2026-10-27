/** POST /api/support/share — разрешить (или запретить) друзьям видеть ваши публикации для поддержки. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sameOrigin } from "@/lib/support";

const Body = z.object({ share: z.boolean() });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Запрос не с нашего сайта" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || !canPublish(user)) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  await prisma.user.update({ where: { id: user.id }, data: { shareForSupport: parsed.data.share } });
  await prisma.auditLog
    .create({ data: { userId: user.id, action: parsed.data.share ? "support_share_on" : "support_share_off" } })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
