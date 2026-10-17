/** Подключение к Redis и общая очередь публикаций (BullMQ). */
import { Queue } from "bullmq";
import IORedis from "ioredis";

const globalForRedis = globalThis as unknown as {
  connection: IORedis | undefined;
};

export const connection =
  globalForRedis.connection ??
  new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
    maxRetriesPerRequest: null, // требование BullMQ
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.connection = connection;
}

export const PUBLISH_QUEUE = "publish";

/** Очередь задач публикации. Одна задача = публикация поста в одну сеть. */
export const publishQueue = new Queue(PUBLISH_QUEUE, { connection });

export type PublishJobData = {
  targetId: string;
};

export const PUBLISH_ATTEMPTS = 3;

/** Поставить публикацию одной цели в очередь (с ретраями и задержкой). */
export async function enqueuePublish(targetId: string, delayMs = 0): Promise<void> {
  await publishQueue.add(
    "publish",
    { targetId } satisfies PublishJobData,
    {
      // jobId защищает от двойной постановки одной и той же цели.
      jobId: `t-${targetId}-${Date.now()}`,
      attempts: PUBLISH_ATTEMPTS,
      backoff: { type: "exponential", delay: 20_000 },
      removeOnComplete: true,
      removeOnFail: 200,
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    }
  );
}

// --- Живость воркера -------------------------------------------------------
// Воркер раз в 15 секунд обновляет отметку в Redis. Интерфейс и `npm run doctor`
// по ней видят, что очередь действительно кто-то разбирает: без этого
// публикации молча «висят в очереди», и причина неочевидна.

const HEARTBEAT_KEY = "apex:worker:heartbeat";
export const HEARTBEAT_STALE_MS = 90_000;

export async function markWorkerAlive(): Promise<void> {
  await connection.set(HEARTBEAT_KEY, String(Date.now()), "EX", 300).catch(() => {});
}

export type WorkerHealth = { alive: boolean; lastSeen: Date | null; reachable: boolean };

/** Когда воркер последний раз подавал признаки жизни. */
export async function workerHealth(): Promise<WorkerHealth> {
  try {
    const raw = await connection.get(HEARTBEAT_KEY);
    const ts = raw ? Number(raw) : NaN;
    if (!Number.isFinite(ts)) return { alive: false, lastSeen: null, reachable: true };
    return {
      alive: Date.now() - ts < HEARTBEAT_STALE_MS,
      lastSeen: new Date(ts),
      reachable: true,
    };
  } catch {
    return { alive: false, lastSeen: null, reachable: false };
  }
}
