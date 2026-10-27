/**
 * Фоновый воркер публикаций APX.
 * Берёт задачи из очереди BullMQ, готовит версию видео под сеть и публикует
 * через src/lib/publish.ts. Ретраи, итоговые статусы и уборка файлов — здесь.
 */
import "../lib/load-env";
import { UnrecoverableError, Worker } from "bullmq";
import {
  connection,
  markWorkerAlive,
  PUBLISH_QUEUE,
  type PublishJobData,
} from "../lib/redis";
import { prisma } from "../lib/db";
import { publishTarget, recordFailure } from "../lib/publish";
import { removeMediaFamily } from "../lib/media";
import { sendFailureDigests } from "../lib/notify";
import { sweepStuckTargets } from "../lib/publish";
import { collectMetricsOnce, METRICS_INTERVAL_MS } from "../lib/metrics";

console.log(
  `[worker] запуск обработчика очереди публикаций…${
    process.env.PUBLISH_DRY_RUN ? " (ТЕСТОВЫЙ ПРОГОН: в сети ничего не отправляется)" : ""
  }`
);

const worker = new Worker<PublishJobData>(
  PUBLISH_QUEUE,
  async (job) => {
    await publishTarget(job.data.targetId, job.attemptsMade + 1);
  },
  {
    connection,
    concurrency: 2, // параллельно до 2 публикаций (перекодирование нагружает CPU)
    // Подготовка 4K-видео может идти долго — продлеваем блокировку задачи.
    lockDuration: 10 * 60_000,
  }
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[worker] задача ${job.id} упала:`, err.message);
  const final =
    err instanceof UnrecoverableError ||
    err.name === "UnrecoverableError" ||
    job.attemptsMade >= (job.opts.attempts ?? 1);
  await recordFailure(job.data.targetId, err.message, final, job.attemptsMade + 1);
});

worker.on("completed", (job) => {
  console.log(`[worker] задача ${job.id} выполнена`);
});

// Отметка живости: интерфейс и `npm run doctor` показывают, разбирает ли
// кто-нибудь очередь.
void markWorkerAlive();
const beatTimer = setInterval(() => void markWorkerAlive(), 15_000);

// --- Уборка: мастер-файлы завершённых постов удаляются через N дней ---------
const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS ?? 7);

async function sweepMedia() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const old = await prisma.post.findMany({
    where: {
      status: { in: ["DONE", "PARTIAL", "FAILED"] },
      updatedAt: { lt: cutoff },
      mediaDeletedAt: null,
    },
    select: { id: true, mediaPath: true },
    take: 200,
  });
  for (const p of old) {
    await removeMediaFamily(p.mediaPath);
    await prisma.post.update({ where: { id: p.id }, data: { mediaDeletedAt: new Date() } });
  }
  if (old.length) console.log(`[worker] удалены файлы ${old.length} старых постов`);
}
const sweepTimer = setInterval(() => void sweepMedia().catch(() => {}), 60 * 60_000);
void sweepMedia().catch(() => {});

// Публикации, «залипшие» из-за падения воркера, возвращаются в понятное
// состояние: иначе они висят в «публикуется…» вечно.
const stuckTimer = setInterval(() => void sweepStuckTargets().catch(() => {}), 2 * 60_000);
void sweepStuckTargets().catch(() => {});

// Письмо о неудачных публикациях — не чаще раза в сутки на человека.
const notifyTimer = setInterval(
  () => void sendFailureDigests().catch(() => {}),
  30 * 60_000
);

// Сбор охватов: раз в METRICS_INTERVAL_MS обходим опубликованные посты.
// Первый проход — через минуту после старта, чтобы не нагружать запуск.
async function collectMetricsSafe(): Promise<void> {
  try {
    const r = await collectMetricsOnce();
    if (r.checked) {
      console.log(
        `[worker] метрики: проверено ${r.checked}, обновлено ${r.saved}, ошибок ${r.errors}`
      );
    }
  } catch (e) {
    console.error("[worker] сбор метрик упал:", e instanceof Error ? e.message : e);
  }
}
const metricsTimer = setInterval(() => void collectMetricsSafe(), METRICS_INTERVAL_MS);
setTimeout(() => void collectMetricsSafe(), 60_000);

async function shutdown() {
  console.log("[worker] остановка…");
  clearInterval(sweepTimer);
  clearInterval(beatTimer);
  clearInterval(notifyTimer);
  clearInterval(stuckTimer);
  clearInterval(metricsTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
