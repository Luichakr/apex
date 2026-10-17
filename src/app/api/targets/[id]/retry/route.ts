/** POST /api/targets/:id/retry — повторить публикацию в сеть, где была ошибка. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { enqueuePublish } from "@/lib/redis";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL), 303);
  const { id } = await params;

  const target = await prisma.postTarget.findFirst({
    where: { id, post: { userId: user.id } },
    include: { post: true },
  });
  const back = (q: string) => NextResponse.redirect(new URL(`/posts?${q}`, env.APP_URL), 303);
  if (!target || target.status !== "FAILED") return back("retry=skip");
  if (!target.socialAccountId) return back("retry=no_account");
  if (target.post.mediaDeletedAt) return back("retry=no_media");

  await prisma.postTarget.update({
    where: { id },
    data: { status: "QUEUED", error: null, stage: null, progress: null },
  });
  await prisma.post.update({ where: { id: target.postId }, data: { status: "PUBLISHING" } });
  await enqueuePublish(id);
  return back("retry=ok");
}
