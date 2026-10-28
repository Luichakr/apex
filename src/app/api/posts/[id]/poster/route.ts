/** GET /api/posts/:id/poster — кадр-обложка поста (только владельцу поста). */
import { readFile } from "node:fs/promises";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { posterPathFor } from "@/lib/video";
import { demoThumbSvg } from "@/lib/demo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (id.startsWith("demo-")) {
    return new Response(demoThumbSvg(Number(id.slice(5)) || 0), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
    });
  }
  const post = await prisma.post.findFirst({
    where: { id, userId: user.id },
    select: { mediaPath: true, mediaDeletedAt: true },
  });
  if (!post) return new Response("Not found", { status: 404 });
  try {
    if (post.mediaDeletedAt) throw new Error("deleted");
    const data = await readFile(posterPathFor(post.mediaPath));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    // Нет кадра (старый пост или файл удалён) — нейтральная заглушка.
    return new Response(PLACEHOLDER, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300" },
    });
  }
}

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160"><rect width="90" height="160" fill="#f1f1f4"/><g transform="translate(33 68)" fill="none" stroke="rgba(17,17,19,.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4zM8 4v16M16 4v16"/></g></svg>`;
