/** GET /api/demo/thumb?i=N — обложка-заглушка для демо-режима. */
import { demoThumbSvg } from "@/lib/demo";

export async function GET(req: Request) {
  const i = Number(new URL(req.url).searchParams.get("i") ?? 0) || 0;
  return new Response(demoThumbSvg(i), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}
