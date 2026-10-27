/** POST /api/support/send — лайк и/или комментарий под публикацией друга (по клику человека). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, canPublish, clientIp } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { performSupport, sameOrigin } from "@/lib/support";

const Body = z.object({
  targetId: z.string().min(1).max(40),
  like: z.boolean().default(false),
  comment: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Запрос не с нашего сайта" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || !canPublish(user)) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  const ip = clientIp(req.headers) ?? "?";
  if (!(await rateLimit(`support:${user.id}:${ip}`, 30, 3600))) {
    return NextResponse.json({ error: "Слишком много запросов — подождите." }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const r = await performSupport({
    actorId: user.id,
    actorRole: user.role,
    targetId: parsed.data.targetId,
    like: parsed.data.like,
    comment: parsed.data.comment?.trim() || undefined,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
