/**
 * Диспетчер публикации: публикует одну цель (пост в одну сеть).
 * Вызывается воркером. Этапы: подготовка версии видео → загрузка → готово.
 *
 * Повторы безопасны: опубликованная цель не публикуется второй раз, а
 * площадке передаётся сохранённый id контейнера/загрузки прошлой попытки.
 */
import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import { prisma } from "./db";
import { getProvider } from "./providers";
import { getDecryptedAccount } from "./accounts";
import { prepareRendition, removeRenditions, UnpublishableError } from "./renditions";
import { renderCoverFrame } from "./video";
import { resolveSettings } from "./publish-settings";
import { isRetryable, PlatformError } from "./providers/errors";

const DRY_RUN = process.env.PUBLISH_DRY_RUN === "1" || process.env.PUBLISH_DRY_RUN === "true";

export async function publishTarget(targetId: string, attempt = 1): Promise<void> {
  const target = await prisma.postTarget.findUnique({
    where: { id: targetId },
    include: { post: true },
  });
  if (!target) throw new UnrecoverableError(`Цель ${targetId} не найдена`);
  // Уже опубликовано (например, задача повторилась после сбоя воркера).
  if (target.status === "DONE" || target.status === "SKIPPED") return;
  if (!target.socialAccountId) {
    throw new UnrecoverableError("Аккаунт соцсети отключён — публикация отменена");
  }

  await setTarget(targetId, {
    status: "PROCESSING",
    attempts: { increment: 1 },
    stage: "prepare",
    progress: 0,
  });
  if (target.post.status === "SCHEDULED") {
    await prisma.post
      .update({ where: { id: target.postId }, data: { status: "PUBLISHING" } })
      .catch(() => {});
  }

  const provider = getProvider(target.provider);
  if (!provider) throw new UnrecoverableError(`Коннектор для ${target.provider} не готов`);

  const stored = await prisma.socialAccount.findUnique({
    where: { id: target.socialAccountId },
    select: { needsReconnect: true, reconnectReason: true },
  });
  if (stored?.needsReconnect) {
    // Доступ отозван: попытки только жгут лимиты площадки.
    throw new UnrecoverableError(
      stored.reconnectReason ??
        "Доступ к сети отозван — переподключите аккаунт на странице «Аккаунты»"
    );
  }

  let account = await getDecryptedAccount(target.socialAccountId);
  if (!account) throw new UnrecoverableError("Аккаунт соцсети не найден (возможно, отключён)");

  try {
    // 1. Версия видео под требования сети (мастер не трогаем).
    let lastSaved = 0;
    const rendition = await prepareRendition(
      target.post.mediaPath,
      target.post.mediaType,
      target.provider,
      (pct) => {
        if (Date.now() - lastSaved < 2000) return;
        lastSaved = Date.now();
        void setTarget(targetId, { progress: pct }).catch(() => {});
      }
    );
    await setTarget(targetId, {
      stage: "upload",
      progress: null,
      renditionMeta: rendition.meta as unknown as Prisma.InputJsonValue,
    });

    // 2. Загрузка в сеть.
    if (provider.ensureFreshToken) account = await provider.ensureFreshToken(account);
    const result = DRY_RUN
      ? { externalId: `dry-run-${Date.now()}`, externalUrl: undefined, draft: false }
      : await provider.publish(account, {
          filePath: rendition.path,
          mimeType: rendition.mimeType,
          caption: target.captionOverride ?? target.post.caption,
          settings: resolveSettings(target.provider, target.settings),
          coverMs: target.coverMs,
          coverImagePath: target.post.coverPath,
          // Загруженная картинка главнее выбранного кадра.
          renderCover: (maxWidth) =>
            target.post.coverPath
              ? readFile(target.post.coverPath).catch(() => null)
              : target.coverMs === null
                ? Promise.resolve(null)
                : renderCoverFrame(target.post.mediaPath, target.coverMs, maxWidth),
          durationSec: rendition.meta.durationSec,
          attempt,
          remoteId: target.remoteId,
          notBefore: target.post.createdAt,
          saveRemoteId: async (id) => {
            await setTarget(targetId, { remoteId: id });
          },
          onStage: async (stage) => {
            await setTarget(targetId, { stage, progress: null });
          },
        });

    await setTarget(targetId, {
      status: "DONE",
      stage: null,
      progress: null,
      externalId: result.externalId,
      externalUrl: result.externalUrl ?? null,
      isDraft: Boolean(result.draft),
      error: DRY_RUN ? "Тестовый прогон: в сеть ничего не отправлено" : (result.note ?? null),
    });

    await prisma.auditLog
      .create({
        data: {
          userId: account.userId,
          action: DRY_RUN ? "publish_dry_run" : "publish",
          detail: {
            provider: target.provider,
            postId: target.postId,
            externalUrl: result.externalUrl ?? null,
          },
        },
      })
      .catch(() => {});

    await maybeFinishPost(target.postId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof PlatformError && err.resolution === "reconnect") {
      // Помечаем аккаунт, чтобы остальные публикации не бились в ту же стену.
      await prisma.socialAccount
        .update({
          where: { id: target.socialAccountId! },
          data: { needsReconnect: true, reconnectReason: msg },
        })
        .catch(() => {});
      throw new UnrecoverableError(msg);
    }
    if (err instanceof UnpublishableError || !isRetryable(err)) {
      throw new UnrecoverableError(msg);
    }
    throw err instanceof Error ? err : new Error(msg);
  }
}

function setTarget(id: string, data: Prisma.PostTargetUpdateInput) {
  return prisma.postTarget.update({ where: { id }, data });
}

/**
 * Записать результат неудачной попытки. final=true — попыток больше не будет.
 * Вызывается воркером из обработчика `failed`.
 */
export async function recordFailure(
  targetId: string,
  message: string,
  final: boolean,
  nextAttempt?: number
): Promise<void> {
  const t = await prisma.postTarget
    .update({
      where: { id: targetId },
      data: final
        ? { status: "FAILED", error: message, stage: null, progress: null }
        : {
            status: "QUEUED",
            stage: "retry",
            progress: null,
            error: `Попытка не удалась${nextAttempt ? `, повторим (попытка ${nextAttempt})` : ""}: ${message}`,
          },
    })
    .catch(() => null);
  if (t && final) await maybeFinishPost(t.postId);
}

/** Если по всем целям поста больше нет работы — выставить итоговый статус поста. */
export async function maybeFinishPost(postId: string): Promise<void> {
  const targets = await prisma.postTarget.findMany({ where: { postId } });
  const pending = targets.some((t) => t.status === "QUEUED" || t.status === "PROCESSING");
  if (pending) return;

  const done = targets.filter((t) => t.status === "DONE").length;
  const failed = targets.filter((t) => t.status === "FAILED").length;
  const status = failed === 0 ? "DONE" : done === 0 ? "FAILED" : "PARTIAL";
  const post = await prisma.post.update({ where: { id: postId }, data: { status } });
  // Производные версии больше не нужны (Instagram уже скачал файл).
  // Мастер остаётся до истечения срока хранения — для повторов.
  await removeRenditions(post.mediaPath).catch(() => {});
}

/**
 * Цели, застрявшие в работе из-за падения воркера. Повторно НЕ публикуем:
 * отличить «площадка этого не видела» от «площадка приняла, а мы упали до
 * записи» нельзя, а дубль видео на живом канале руками не отменить. Поэтому
 * переводим в понятное состояние и оставляем решение за человеком.
 */
const STUCK_AFTER_MS = 45 * 60_000;

export async function sweepStuckTargets(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await prisma.postTarget.findMany({
    where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
    select: { id: true, postId: true, stage: true, remoteId: true },
  });
  for (const t of stuck) {
    // На этапе подготовки видео в сеть ещё ничего не ушло — можно смело повторять.
    const beforeSending = t.stage === "prepare" && !t.remoteId;
    await prisma.postTarget.update({
      where: { id: t.id },
      data: {
        status: "FAILED",
        stage: null,
        progress: null,
        error: beforeSending
          ? "Обработка прервалась до отправки в сеть — можно повторить"
          : "Связь с сетью прервалась, и подтвердить публикацию не удалось. Проверьте аккаунт, прежде чем повторять: видео могло уйти.",
      },
    });
    await maybeFinishPost(t.postId);
  }
  if (stuck.length) console.log(`[worker] разобрано зависших публикаций: ${stuck.length}`);
}
