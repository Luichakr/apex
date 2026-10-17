/**
 * Лимиты текста по площадкам. Можно импортировать и на клиенте, и на сервере.
 *
 * Источники (официальные API):
 *  - Instagram: подпись до 2200 символов, не более 30 хештегов и 20 упоминаний.
 *  - YouTube: заголовок до 100 символов, описание до 5000 БАЙТ (UTF-8:
 *    кириллица = 2 байта на букву), символы < и > запрещены; если хештегов
 *    больше 15 — YouTube игнорирует их все.
 *  - TikTok (inbox-загрузка): API текст не принимает — подпись вставляется
 *    в приложении при публикации (лимит приложения — 4000 символов).
 */
import type { Provider } from "@prisma/client";

/** Лимит основного текста по сети (для YouTube — байты описания). */
export const CAPTION_LIMITS: Record<Provider, number> = {
  TIKTOK: 4000,
  INSTAGRAM: 2200,
  YOUTUBE: 5000,
  FACEBOOK: 63206,
  // Подпись к видео в канале — 1024 символа. У историй лимит выше (2048),
  // но берём строгий: один и тот же текст должен подойти обоим.
  TELEGRAM: 1024,
  LINKEDIN: 3000,
};

export const YOUTUBE_TITLE_LIMIT = 100;
export const YOUTUBE_DESCRIPTION_BYTES = 5000;
export const INSTAGRAM_MAX_HASHTAGS = 30;
export const INSTAGRAM_MAX_MENTIONS = 20;
export const YOUTUBE_MAX_HASHTAGS = 15;

/** Сети, куда текст через API не передаётся (его вставляют вручную). */
export const CAPTION_NOT_SENT: Provider[] = ["TIKTOK"];

export const PROVIDER_LABEL: Record<Provider, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  FACEBOOK: "Facebook",
  TELEGRAM: "Telegram",
  LINKEDIN: "LinkedIn",
};

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Длина в символах (эмодзи и составные символы — как один). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function countMentions(text: string): number {
  return (text.match(/(^|\s)@[\w.]+/g) ?? []).length;
}

/** Заголовок YouTube из текста: первая непустая строка. */
export function youtubeTitleFrom(text: string): string {
  return (text.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

/** YouTube не принимает < и > в заголовке и описании. */
export function sanitizeYoutube(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

export function truncateBytes(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = utf8Bytes(ch);
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out;
}

export type CaptionIssues = { errors: string[]; warnings: string[] };

/** Что не так с текстом для сети: блокирующие ошибки и предупреждения. */
export function captionIssues(provider: Provider, text: string): CaptionIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const L = PROVIDER_LABEL[provider];

  if (provider === "INSTAGRAM") {
    const n = charCount(text);
    if (n > CAPTION_LIMITS.INSTAGRAM) {
      errors.push(`${L}: текст ${n}/${CAPTION_LIMITS.INSTAGRAM} — лишних ${n - CAPTION_LIMITS.INSTAGRAM}`);
    }
    const tags = countHashtags(text);
    if (tags > INSTAGRAM_MAX_HASHTAGS) {
      errors.push(`${L}: ${tags} хештегов — максимум ${INSTAGRAM_MAX_HASHTAGS}`);
    }
    const mentions = countMentions(text);
    if (mentions > INSTAGRAM_MAX_MENTIONS) {
      errors.push(`${L}: ${mentions} упоминаний — максимум ${INSTAGRAM_MAX_MENTIONS}`);
    }
  }

  if (provider === "YOUTUBE") {
    const title = youtubeTitleFrom(text);
    if (charCount(title) > YOUTUBE_TITLE_LIMIT) {
      errors.push(
        `${L}: заголовок (первая строка) ${charCount(title)}/${YOUTUBE_TITLE_LIMIT} — сократите первую строку`
      );
    }
    const bytes = utf8Bytes(sanitizeYoutube(text));
    if (bytes > YOUTUBE_DESCRIPTION_BYTES) {
      errors.push(
        `${L}: описание ${bytes}/${YOUTUBE_DESCRIPTION_BYTES} байт (кириллица = 2 байта на букву)`
      );
    }
    if (countHashtags(text) > YOUTUBE_MAX_HASHTAGS) {
      warnings.push(`${L}: больше ${YOUTUBE_MAX_HASHTAGS} хештегов — YouTube проигнорирует все`);
    }
    if (/[<>]/.test(text)) warnings.push(`${L}: символы < и > будут заменены на ‹ ›`);
  }

  if (provider === "TIKTOK") {
    const n = charCount(text);
    if (n > CAPTION_LIMITS.TIKTOK) {
      warnings.push(`${L}: текст ${n}/${CAPTION_LIMITS.TIKTOK} — в приложении придётся сократить`);
    }
  }

  if (provider === "TELEGRAM") {
    const n = charCount(text);
    if (n > CAPTION_LIMITS.TELEGRAM) {
      errors.push(
        `${L}: подпись ${n}/${CAPTION_LIMITS.TELEGRAM} — у видео в Telegram лимит подписи меньше, чем у обычного сообщения`
      );
    }
  }

  if (provider === "LINKEDIN") {
    const n = charCount(text);
    if (n > CAPTION_LIMITS.LINKEDIN) {
      errors.push(`${L}: текст ${n}/${CAPTION_LIMITS.LINKEDIN} — лишних ${n - CAPTION_LIMITS.LINKEDIN}`);
    }
  }

  if (provider === "FACEBOOK") {
    const n = charCount(text);
    if (n > CAPTION_LIMITS.FACEBOOK) errors.push(`${L}: текст ${n}/${CAPTION_LIMITS.FACEBOOK}`);
  }

  return { errors, warnings };
}

/** Совместимость: первая блокирующая ошибка или null. */
export function captionError(provider: Provider, text: string): string | null {
  return captionIssues(provider, text).errors[0] ?? null;
}

/** Длина текста «как считает сеть» — для счётчиков в интерфейсе. */
export function measureFor(provider: Provider, text: string): { used: number; limit: number; unit: string } {
  if (provider === "YOUTUBE") {
    return { used: utf8Bytes(sanitizeYoutube(text)), limit: YOUTUBE_DESCRIPTION_BYTES, unit: "байт" };
  }
  return { used: charCount(text), limit: CAPTION_LIMITS[provider], unit: "симв." };
}
