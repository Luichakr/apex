/**
 * Сбор охватов опубликованных постов.
 *
 * Раз в METRICS_INTERVAL_MS воркер обходит все цели со статусом DONE и
 * спрашивает у площадки свежие показатели. На каждый замер пишем отдельную
 * строку в PostMetric — так получается история, по которой видно рост.
 *
 * Чтобы не выжечь квоту Meta/Google, идём последовательно и первые две недели
 * опрашиваем часто (6 ч), дальше — реже (сутки). Прошли месяц — больше не
 * спрашиваем, цифры практически не меняются.
 */
import type { PostTarget, Provider } from "@prisma/client";
import { prisma } from "./db";
import { getDecryptedAccount } from "./accounts";
import { getProvider } from "./providers";
import type { FetchedMetrics } from "./providers/types";

export const METRICS_INTERVAL_MS = 6 * 3600 * 1000;
const RECENT_WINDOW_MS = 14 * 86400 * 1000; // первые 2 недели — опрос каждые 6 ч
const SLOW_INTERVAL_MS = 24 * 3600 * 1000; // дальше — раз в сутки
const STOP_AFTER_MS = 31 * 86400 * 1000; // через месяц больше не трогаем

/** Пауза между обращениями к одной площадке, чтобы не упираться в rate limit. */
const BETWEEN_CALLS_MS = 600;

/** Собрать свежие метрики по всем опубликованным целям, которым пора. */
export async function collectMetricsOnce(): Promise<{
  checked: number;
  saved: number;
  errors: number;
}> {
  const now = Date.now();
  const stopBefore = new Date(now - STOP_AFTER_MS);
  const slowCutoff = new Date(now - RECENT_WINDOW_MS);

  // Берём только цели с реальным id публикации, не черновики, не удалённые медиа.
  const targets = await prisma.postTarget.findMany({
    where: {
      status: "DONE",
      isDraft: false,
      externalId: { not: null },
      socialAccountId: { not: null },
      updatedAt: { gte: stopBefore },
    },
    orderBy: { updatedAt: "asc" },
  });

  const due = targets.filter((t) => {
    if (!t.metricsCheckedAt) return true;
    const age = now - t.updatedAt.getTime();
    const since = now - t.metricsCheckedAt.getTime();
    // Для старых публикаций опрашиваем реже.
    const need = t.updatedAt < slowCutoff ? SLOW_INTERVAL_MS : METRICS_INTERVAL_MS;
    void age;
    return since >= need;
  });

  let saved = 0;
  let errors = 0;

  // Группируем по провайдеру, чтобы между запросами одной сети делать паузу.
  const byProvider = new Map<Provider, PostTarget[]>();
  for (const t of due) {
    const list = byProvider.get(t.provider) ?? [];
    list.push(t);
    byProvider.set(t.provider, list);
  }

  for (const [, list] of byProvider) {
    for (const target of list) {
      try {
        const res = await fetchOne(target);
        if (res) saved++;
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.postTarget
          .update({
            where: { id: target.id },
            data: { metricsCheckedAt: new Date(), metricsError: msg.slice(0, 500) },
          })
          .catch(() => {});
      }
      await new Promise((r) => setTimeout(r, BETWEEN_CALLS_MS));
    }
  }

  return { checked: due.length, saved, errors };
}

async function fetchOne(target: PostTarget): Promise<FetchedMetrics | null> {
  const provider = getProvider(target.provider);
  if (!provider?.fetchMetrics) {
    await prisma.postTarget.update({
      where: { id: target.id },
      data: { metricsCheckedAt: new Date(), metricsError: null },
    });
    return null;
  }
  if (!target.socialAccountId || !target.externalId) return null;

  let account = await getDecryptedAccount(target.socialAccountId);
  if (!account) return null;
  if (provider.ensureFreshToken) {
    account = await provider.ensureFreshToken(account);
  }

  const metrics = await provider.fetchMetrics(account, {
    externalId: target.externalId,
    settings: (target.settings as Record<string, unknown> | null) ?? null,
    renditionMeta: (target.renditionMeta as Record<string, unknown> | null) ?? null,
  });

  // Площадка ещё не отдаёт данные — отмечаем попытку, строку не создаём.
  if (!metrics) {
    await prisma.postTarget.update({
      where: { id: target.id },
      data: { metricsCheckedAt: new Date(), metricsError: null },
    });
    return null;
  }

  await prisma.$transaction([
    prisma.postMetric.create({
      data: {
        targetId: target.id,
        views: metrics.views ?? null,
        reach: metrics.reach ?? null,
        likes: metrics.likes ?? null,
        comments: metrics.comments ?? null,
        shares: metrics.shares ?? null,
        saves: metrics.saves ?? null,
        raw: (metrics.raw ?? undefined) as object | undefined,
      },
    }),
    prisma.postTarget.update({
      where: { id: target.id },
      data: { metricsCheckedAt: new Date(), metricsError: null },
    }),
  ]);

  return metrics;
}
