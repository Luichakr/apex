/**
 * Выбор кадра-обложки.
 *
 * Браузер снимает кадры только для показа кандидатов — в сеть уходит не эта
 * картинка, а миллисекунда. Настоящую обложку по ней отрисует ffmpeg на
 * сервере: он работает с исходником в полном качестве, а не с тем, что
 * успел декодировать тег video.
 */

/** Доли длительности, на которых берутся кадры-кандидаты. */
export const CANDIDATE_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

const SEEK_TIMEOUT_MS = 10_000;

/** Не дать выйти за пределы ролика: последний кадр — это duration минус миг. */
export function clampCoverMs(ms: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(ms)) return 0;
  return Math.min(Math.max(Math.round(ms), 0), Math.max(Math.round(durationMs) - 1, 0));
}

/** 0:07 или 1:02:33 */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Перемотать видео и дождаться готового кадра. */
async function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (
    Math.abs(video.currentTime - seconds) < 0.01 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      video.removeEventListener("seeked", ok);
      video.removeEventListener("error", bad);
      err ? reject(err) : resolve();
    };
    const ok = () => done();
    const bad = () => done(new Error("Не удалось прочитать видео"));
    const timer = setTimeout(() => done(new Error("Перемотка заняла слишком долго")), SEEK_TIMEOUT_MS);
    video.addEventListener("seeked", ok, { once: true });
    video.addEventListener("error", bad, { once: true });
    video.currentTime = seconds;
  });
}

/** Снять кадр в картинку (для показа кандидатов в интерфейсе). */
export async function captureFrame(
  video: HTMLVideoElement,
  ms: number,
  maxWidth = 480
): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
    throw new Error("Видео ещё не готово");
  }
  await seekTo(video, clampCoverMs(ms, video.duration * 1000) / 1000);

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не дал холст для кадра");
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Кадр не удалось сохранить"))),
      "image/jpeg",
      0.9
    );
  });
}

/** Миллисекунды кандидатов для ролика такой длительности. */
export function candidateTimestamps(durationMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  return CANDIDATE_FRACTIONS.map((f) => clampCoverMs(durationMs * f, durationMs));
}
