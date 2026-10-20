/**
 * POST /api/posts/:id/delete — убрать пост из APEX (и отменить, если он
 * запланирован). Уже опубликованное в сетях не трогается: удалять там нужно
 * в самих приложениях.
 */
import { NextResponse } from "next/server";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { removeMediaFamily } from "@/lib/media";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL), 303);
  const back = (q: string) => NextResponse.redirect(new URL(`/posts?${q}`, env.APP_URL), 303);
  if (!canPublish(user)) return back("retry=viewer");
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: user.id },
    include: { targets: { select: { status: true } } },
  });
  if (!post) return back("deleted=missing");
  // Пока видео уходит в сеть, удалять нельзя: загрузка оборвётся на середине.
  if (post.targets.some((t) => t.status === "PROCESSING")) return back("deleted=busy");

  // Задачи в очереди сами увидят, что поста нет, и тихо завершатся.
  await prisma.post.delete({ where: { id } });
  await removeMediaFamily(post.mediaPath);
  await prisma.auditLog
    .create({ data: { userId: user.id, action: post.status === "SCHEDULED" ? "cancel_post" : "delete_post", detail: { postId: id } } })
    .catch(() => {});
  return back(post.status === "SCHEDULED" ? "deleted=canceled" : "deleted=ok");
}
