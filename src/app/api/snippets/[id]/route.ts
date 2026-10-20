/** DELETE /api/snippets/:id — удалить свой шаблон текста. */
import { NextResponse } from "next/server";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !canPublish(user)) return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  const { id } = await params;
  await prisma.captionSnippet.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
