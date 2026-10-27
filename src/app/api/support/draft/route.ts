/** POST /api/support/draft — три варианта комментария от Claude (только предложение). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { eligibleWhere, sameOrigin } from "@/lib/support";
import { draftComments, draftsAvailable } from "@/lib/support-draft";

const Body = z.object({ targetId: z.string().min(1).max(40) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Запрос не с нашего сайта" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || !canPublish(user)) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  if (!draftsAvailable()) return NextResponse.json({ error: "Черновики не настроены" }, { status: 400 });
  if (!(await rateLimit(`draft:${user.id}`, 40, 3600))) {
    return NextResponse.json({ error: "Слишком много запросов — подождите." }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const target = await prisma.postTarget.findFirst({
    where: { id: parsed.data.targetId, ...eligibleWhere(user.id) },
    include: { post: { select: { caption: true } } },
  });
  if (!target) return NextResponse.json({ error: "Публикация недоступна" }, { status: 404 });
  const drafts = await draftComments(target.captionOverride ?? target.post.caption);
  return NextResponse.json({ drafts });
}
