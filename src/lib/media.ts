/**
 * Приём загруженных видео: потоковая запись на диск (без буферизации в памяти),
 * определение формата по содержимому (ffprobe), публичные подписанные ссылки.
 *
 * Загруженный файл — «мастер»: он НИКОГДА не перекодируется на месте.
 * Версии под каждую сеть готовит воркер (см. src/lib/renditions.ts).
 */
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHmac } from "node:crypto";
import Busboy from "busboy";
import { randomToken, safeEqual } from "./crypto";
import { getEnv } from "./env";
import { mimeFromProbe, normalizeCoverImage, probeMedia, type MediaInfo } from "./video";

export function mediaDir(): string {
  return process.env.MEDIA_DIR || join(process.cwd(), "media");
}

/** Максимальный размер исходника (TikTok принимает до 4 ГБ). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const ALLOWED_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "qt"]);
const ALLOWED_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
/** Обложка — картинка, а не фильм: держим её маленькой. */
export const MAX_COVER_BYTES = 12 * 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export type SavedMedia = {
  path: string;
  size: number;
  mimeType: string;
  originalName: string;
  info: MediaInfo;
};

export type ParsedUpload = {
  fields: Record<string, string[]>;
  media: SavedMedia;
  /** Загруженная пользователем обложка (если прислал). */
  coverUpload: string | null;
};

/**
 * Разобрать multipart-запрос потоково: поля формы + видеофайл прямо на диск.
 * Файл проверяется по содержимому (ffprobe), а не по MIME от браузера
 * (Safari иногда присылает пустой тип).
 */
export async function receiveUpload(req: Request): Promise<ParsedUpload> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data") || !req.body) {
    throw new UploadError("Ожидалась форма с файлом");
  }
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });

  const fields: Record<string, string[]> = {};
  let saved: { path: string; size: number; name: string } | null = null;
  let cover: { path: string; size: number } | null = null;
  let fileWrite: Promise<void> | null = null;
  let coverWrite: Promise<void> | null = null;
  let tooBig = false;

  const bb = Busboy({
    headers: { "content-type": ct },
    // Два файла: само видео и необязательная обложка.
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 50, fieldSize: 256 * 1024 },
  });

  bb.on("field", (name, value) => {
    (fields[name] ??= []).push(value);
  });

  bb.on("file", (name, stream, info) => {
    if (name === "cover" && !cover) {
      const ext = (basename(info.filename || "").toLowerCase().split(".").pop() ?? "").replace(/[^a-z0-9]/g, "");
      if (!ALLOWED_IMAGE_EXT.has(ext)) {
        stream.resume();
        return;
      }
      const path = join(dir, `${Date.now()}-${randomToken(8)}.cover-src.${ext}`);
      cover = { path, size: 0 };
      const c = cover;
      stream.on("data", (chunk: Buffer) => {
        c.size += chunk.length;
      });
      coverWrite = pipeline(stream, createWriteStream(path));
      return;
    }
    if (name !== "video" || saved) {
      stream.resume();
      return;
    }
    const orig = basename(info.filename || "video");
    const ext = (orig.toLowerCase().split(".").pop() ?? "").replace(/[^a-z0-9]/g, "");
    const safeExt = ALLOWED_EXT.has(ext) ? ext : "bin";
    const path = join(dir, `${Date.now()}-${randomToken(8)}.${safeExt}`);
    saved = { path, size: 0, name: orig };
    const current = saved;
    stream.on("data", (chunk: Buffer) => {
      current.size += chunk.length;
    });
    stream.on("limit", () => {
      tooBig = true;
    });
    fileWrite = pipeline(stream, createWriteStream(path));
  });

  try {
    await pipeline(Readable.fromWeb(req.body as never), bb);
    if (fileWrite) await fileWrite;
    if (coverWrite) await coverWrite;
  } catch (e) {
    if (saved) await unlink((saved as { path: string }).path).catch(() => {});
    throw new UploadError(
      "Загрузка прервалась. Проверьте соединение и попробуйте ещё раз."
    );
  }

  const file = saved as { path: string; size: number; name: string } | null;
  if (!file) throw new UploadError("Прикрепите видеофайл");
  if (tooBig) {
    await unlink(file.path).catch(() => {});
    throw new UploadError("Файл больше 4 ГБ", 413);
  }

  let info: MediaInfo;
  try {
    info = await probeMedia(file.path);
  } catch {
    await unlink(file.path).catch(() => {});
    throw new UploadError("Не удалось прочитать видео — файл повреждён или это не видео");
  }
  if (!info.video) {
    await unlink(file.path).catch(() => {});
    throw new UploadError("В файле нет видеодорожки");
  }
  const mimeType = mimeFromProbe(info, file.name);
  if (mimeType === "application/octet-stream") {
    await unlink(file.path).catch(() => {});
    throw new UploadError("Неподдерживаемый формат. Подойдут MP4, MOV, WebM, MKV.");
  }
  // Обложку приводим к JPEG: площадки принимают его надёжнее всего, а заодно
  // отсекаем слишком тяжёлые файлы.
  let coverUpload: string | null = null;
  const rawCover = cover as { path: string; size: number } | null;
  if (rawCover) {
    coverUpload =
      rawCover.size <= MAX_COVER_BYTES ? await normalizeCoverImage(rawCover.path, file.path) : null;
    await unlink(rawCover.path).catch(() => {});
  }

  const size = (await stat(file.path)).size;
  return {
    fields,
    media: { path: file.path, size, mimeType, originalName: file.name, info },
    coverUpload,
  };
}

/** Удалить мастер и все производные версии поста. */
export async function removeMediaFamily(masterPath: string): Promise<void> {
  if (!masterPath) return;
  const dir = mediaDir();
  const stem = basename(masterPath).replace(/\.[^.]+$/, "");
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => n === basename(masterPath) || n.startsWith(stem + "."))
      .map((n) => unlink(join(dir, n)).catch(() => {}))
  );
}

// --- Публичный подписанный URL видео (нужен Instagram) ----------------------
//
// Instagram скачивает видео сам по публичной HTTPS-ссылке. Чтобы ссылки нельзя
// было подобрать, они подписываются HMAC и имеют срок годности.

function mediaSecret(): Buffer {
  // Отдельный подключ, а не сам SESSION_SECRET: тем же секретом подписаны
  // сессии, и утечка подписи ссылки не должна давать ничего сверх неё.
  return createHmac("sha256", Buffer.from(process.env.SESSION_SECRET ?? "", "base64"))
    .update("subkey:media-url:v1")
    .digest();
}

function sign(name: string, exp: number): string {
  return createHmac("sha256", mediaSecret())
    .update(`${name}:${exp}`)
    .digest("hex");
}

/**
 * Публичная ссылка на видео для Instagram: он скачивает файл сам, в первые
 * минуты после создания контейнера. Два часа — с большим запасом, а короткий
 * срок жизни ограничивает ущерб, если ссылка куда-то утечёт.
 */
export function publicMediaUrl(filePath: string, ttlSeconds = 2 * 3600): string {
  const name = basename(filePath);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(name, exp);
  const url = new URL(`/api/media/${encodeURIComponent(name)}`, getEnv().APP_URL);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** Проверка подписи для отдачи файла. Возвращает абсолютный путь или null. */
export function verifiedMediaPath(
  name: string,
  exp: string | null,
  sig: string | null
): string | null {
  if (!exp || !sig) return null;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return null;
  // Защита от обхода каталога: допускаем только простое имя файла.
  if (name !== basename(name)) return null;
  if (!safeEqual(sign(name, expNum), sig)) return null;
  return join(mediaDir(), name);
}
