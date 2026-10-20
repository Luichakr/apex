/** POST /api/snippets — сохранить фрагмент текста (хештеги, подпись). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";

const Body = z.object({
  title: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(2200),
});
const MAX_SNIPPETS = 30;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canPublish(user)) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нужны название и текст" }, { status: 400 });
  const count = await prisma.captionSnippet.count({ where: { userId: user.id } });
  if (count >= MAX_SNIPPETS) {
    return NextResponse.json({ error: `Не больше ${MAX_SNIPPETS} шаблонов — удалите ненужные` }, { status: 400 });
  }
  const s = await prisma.captionSnippet.create({
    data: { userId: user.id, ...parsed.data },
    select: { id: true, title: true, text: true },
  });
  return NextResponse.json(s);
}
