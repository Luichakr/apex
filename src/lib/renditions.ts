/**
 * Подготовка версии видео под конкретную сеть (выполняется в воркере).
 * Мастер-файл никогда не изменяется. Готовая версия кешируется на диске,
 * повторные попытки публикации её переиспользуют.
 */
import { stat, unlink } from "node:fs/promises";
import type { Provider } from "@prisma/client";
import {
  buildFfmpegArgs,
  describeOutput,
  planRendition,
  probeMedia,
  runFfmpeg,
  verifyRendition,
  type MediaInfo,
  type ProgressFn,
  type RenditionMeta,
} from "./video";

export type PreparedRendition = {
  path: string;
  mimeType: string;
  meta: RenditionMeta;
};

/** Версия готовится один раз даже при параллельных задачах. */
const inflight = new Map<string, Promise<PreparedRendition>>();

export function renditionPathFor(masterPath: string, provider: Provider): string {
  return masterPath.replace(/\.[^./]+$/, "") + `.${provider.toLowerCase()}.mp4`;
}

export class UnpublishableError extends Error {}

export async function prepareRendition(
  masterPath: string,
  masterMime: string,
  provider: Provider,
  onProgress?: ProgressFn
): Promise<PreparedRendition> {
  const out = renditionPathFor(masterPath, provider);
  const existing = inflight.get(out);
  if (existing) return existing;
  const job = doPrepare(masterPath, masterMime, provider, out, onProgress).finally(
    () => inflight.delete(out)
  );
  inflight.set(out, job);
  return job;
}

async function doPrepare(
  masterPath: string,
  masterMime: string,
  provider: Provider,
  out: string,
  onProgress?: ProgressFn
): Promise<PreparedRendition> {
  const info: MediaInfo = await probeMedia(masterPath);
  const { plan, warnings, errors } = planRendition(provider, info);
  if (errors.length) throw new UnpublishableError(errors.join("; "));

  if (plan.kind === "original") {
    return {
      path: masterPath,
      mimeType: masterMime,
      meta: describeOutput(plan, info, warnings),
    };
  }

  // Кеш: версия уже сделана в прошлой попытке.
  const cached = await stat(out).catch(() => null);
  if (cached && cached.size > 0) {
    const outInfo = await probeMedia(out).catch(() => null);
    if (outInfo && verifyRendition(provider, outInfo).length === 0) {
      return { path: out, mimeType: "video/mp4", meta: describeOutput(plan, outInfo, warnings) };
    }
    await unlink(out).catch(() => {});
  }

  const args = await buildFfmpegArgs(plan, info);
  await runFfmpeg(masterPath, out, args, info.duration, onProgress);

  let outInfo = await probeMedia(out);
  let issues = verifyRendition(provider, outInfo);

  // Страховка лимита размера Instagram: пережать с меньшим битрейтом.
  if (issues.some((i) => i.startsWith("размер")) && plan.kind === "encode" && plan.maxrateKbps) {
    const tighter = { ...plan, maxrateKbps: Math.floor(plan.maxrateKbps * 0.75), crf: plan.crf + 2 };
    await runFfmpeg(masterPath, out, await buildFfmpegArgs(tighter, info), info.duration, onProgress);
    outInfo = await probeMedia(out);
    issues = verifyRendition(provider, outInfo);
  }
  if (issues.length) {
    await unlink(out).catch(() => {});
    throw new UnpublishableError(
      `Не удалось подготовить видео под требования сети: ${issues.join(", ")}`
    );
  }
  onProgress?.(100);
  return { path: out, mimeType: "video/mp4", meta: describeOutput(plan, outInfo, warnings) };
}

/** Удалить производные версии (мастер не трогаем). */
export async function removeRenditions(masterPath: string): Promise<void> {
  const providers: Provider[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"];
  await Promise.all(
    providers.map((p) => unlink(renditionPathFor(masterPath, p)).catch(() => {}))
  );
}
