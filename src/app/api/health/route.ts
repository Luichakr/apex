/**
 * GET /api/health — минимальная проверка доступности (без секретов и данных).
 * Нужна, чтобы `npm run doctor` и внешний мониторинг могли убедиться, что сайт
 * отвечает по публичному адресу: именно по нему Instagram забирает видео.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, app: "APX", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
