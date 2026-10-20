/** POST /api/posts — потоково принять видео и поставить публикацию в очередь. */
import { NextResponse } from "next/server";
import type { Prisma, Provider } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { receiveUpload, removeMediaFamily, UploadError } from "@/lib/media";
import { enqueuePublish } from "@/lib/redis";
import { captionIssues } from "@/lib/limits";
import { makePoster, planRendition } from "@/lib/video";
import { resolveSettings } from "@/lib/publish-settings";

export const maxDuration = 3600;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (user.role === "VIEWER") {
    return NextResponse.json(
      { error: "Ваша роль — наблюдатель: публикация недоступна" },
      { status: 403 }
    );
  }

  let upload;
  try {
    upload = await receiveUpload(req);
  } catch (e) {
    const status = e instanceof UploadError ? e.status : 400;
    const msg = e instanceof Error ? e.message : "Ошибка загрузки файла";
    return NextResponse.json({ error: msg }, { status });
  }
  const { fields, media, coverUpload } = upload;
  const field = (k: string) => fields[k]?.[0] ?? "";
  // Любая ошибка ниже — удаляем уже сохранённый файл.
  const reject = async (error: string, status = 400) => {
    await removeMediaFamily(media.path);
    return NextResponse.json({ error }, { status });
  };

  const caption = field("caption").trim();
  const accountIds = (fields.accountIds ?? []).map(String).filter(Boolean);

  // Необязательный отдельный текст по сетям: JSON вида {"TIKTOK":"...","YOUTUBE":"..."}
  let overrides: Partial<Record<Provider, string>> = {};
  if (field("overrides")) {
    try {
      overrides = JSON.parse(field("overrides"));
    } catch {
      /* игнорируем некорректный JSON */
    }
  }
  const effectiveCaption = (p: Provider) =>
    overrides[p]?.trim() ? overrides[p]!.trim() : caption;

  // Кадр-обложка: миллисекунда от начала ролика.
  let coverMs: number | null = null;
  if (field("coverMs")) {
    const n = Number(field("coverMs"));
    const durationMs = (media.info.duration || 0) * 1000;
    if (Number.isFinite(n) && n >= 0 && (!durationMs || n < durationMs)) coverMs = Math.round(n);
  }

  // Настройки публикации по сетям: {"YOUTUBE":{...},"TIKTOK":{...}}
  let settingsByProvider: Record<string, unknown> = {};
  if (field("settings")) {
    try {
      const parsed = JSON.parse(field("settings"));
      if (parsed && typeof parsed === "object") settingsByProvider = parsed;
    } catch {
      /* некорректный JSON — возьмём значения по умолчанию */
    }
  }

  // Необязательное время отложенной публикации.
  let scheduledAt: Date | null = null;
  if (field("scheduledAt")) {
    const d = new Date(field("scheduledAt"));
    if (Number.isNaN(d.getTime())) return reject("Неверная дата публикации");
    if (d.getTime() < Date.now() - 60_000) {
      return reject("Время публикации уже прошло — выберите время в будущем");
    }
    if (d.getTime() > Date.now() + 30_000) scheduledAt = d;
  }
  const delayMs = scheduledAt ? scheduledAt.getTime() - Date.now() : 0;

  if (accountIds.length === 0) {
    return reject("Выберите хотя бы одну сеть для публикации");
  }

  // Берём только аккаунты, принадлежащие этому пользователю.
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: accountIds }, userId: user.id },
  });
  if (accounts.length === 0) return reject("Аккаунты не найдены");

  // Проверки ДО постановки в очередь: лимиты текста и требования к видео.
  const problems: string[] = [];
  for (const a of accounts) {
    problems.push(...captionIssues(a.provider, effectiveCaption(a.provider)).errors);
    problems.push(...planRendition(a.provider, media.info).errors);
  }
  if (problems.length > 0) {
    return reject(
      "Публикация не пройдёт проверку сетей:\n• " + [...new Set(problems)].join("\n• ")
    );
  }

  // Обложка для списка публикаций (быстро, один кадр).
  await makePoster(media.path, media.info);

  const post = await prisma.post.create({
    data: {
      userId: user.id,
      caption,
      mediaPath: media.path,
      mediaType: media.mimeType,
      mediaSize: BigInt(media.size),
      mediaName: media.originalName,
      mediaMeta: media.info as unknown as Prisma.InputJsonValue,
      coverPath: coverUpload,
      status: scheduledAt ? "SCHEDULED" : "PUBLISHING",
      scheduledAt,
      targets: {
        create: accounts.map((a) => ({
          socialAccountId: a.id,
          provider: a.provider,
          status: "QUEUED" as const,
          captionOverride: overrides[a.provider]?.trim() || null,
          coverMs,
          settings: resolveSettings(
            a.provider,
            settingsByProvider[a.provider]
          ) as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: { targets: true },
  });

  for (const target of post.targets) {
    await enqueuePublish(target.id, delayMs);
  }

  return NextResponse.json({ ok: true, postId: post.id });
}
