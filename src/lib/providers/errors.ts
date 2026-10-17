/**
 * Разбор ошибок площадок: повторять попытку, сдаться или просить переподключить
 * аккаунт. Коды — из официальных ответов API (справочный факт, не чужой код).
 *
 * Делить ошибки важно: бессмысленный повтор съедает дневные лимиты площадки и
 * задерживает остальные публикации, а отказ от повтора там, где сеть просто
 * «икнула», теряет публикацию на ровном месте.
 */
export type Resolution = "retry" | "permanent" | "reconnect";

export class PlatformError extends Error {
  readonly retryable: boolean;
  readonly resolution: Resolution;
  /** Не начинать повтор раньше этого момента (из Retry-After или лимитов). */
  readonly retryAfterMs?: number;

  constructor(message: string, resolution: Resolution | boolean, retryAfterMs?: number) {
    super(message);
    this.name = "PlatformError";
    this.resolution =
      typeof resolution === "boolean" ? (resolution ? "retry" : "permanent") : resolution;
    this.retryable = this.resolution === "retry";
    this.retryAfterMs = retryAfterMs;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429 || status === 0;
}

export function httpError(prefix: string, status: number, message?: string): PlatformError {
  return new PlatformError(
    `${prefix}: ${message || `HTTP ${status}`}`,
    isRetryableStatus(status)
  );
}

/** Повторять ли попытку после этой ошибки. Сетевые сбои — да. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof PlatformError) return err.retryable;
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const status = Number(
    e?.response?.status ?? e?.status ?? (typeof e?.code === "number" ? e.code : NaN)
  );
  if (Number.isFinite(status) && status >= 400) return isRetryableStatus(status);
  return true; // сеть, таймаут, неизвестное — пробуем ещё
}

/** Заголовок Retry-After приходит и числом секунд, и датой. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

// --- Meta (Instagram, Facebook) --------------------------------------------

export type MetaError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_msg?: string;
  error_user_title?: string;
};

/** Временные сбои Meta — сюда же попадают её собственные перегрузки. */
const META_TRANSIENT = new Set([1, 2, 4, 17, 341, 368, 1390008]);
/** Превышение частоты запросов: подождать и повторить. */
const META_RATE_LIMIT = new Set([
  4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014,
]);

/** Подкоды Meta, после которых повтор бессмыслен, с понятным объяснением. */
const META_PERMANENT: Record<number, string> = {
  2207001: "Instagram счёл публикацию спамом",
  2207003: "Instagram не успел скачать видео по ссылке",
  2207004: "файл слишком большой",
  2207005: "неподдерживаемый формат изображения",
  2207006: "файл не найден",
  2207008: "срок жизни заготовки истёк",
  2207009: "соотношение сторон вне допустимого (от 4:5 до 1.91:1)",
  2207010: "подпись слишком длинная",
  2207020: "медиа устарело",
  2207023: "неизвестный тип медиа",
  2207026: "неподдерживаемый формат видео",
  2207028: "карусель не прошла проверку",
  2207032: "Instagram не смог создать публикацию",
  2207042: "достигнут дневной лимит Instagram — 25 публикаций в сутки",
  2207050: "действия аккаунта ограничены Instagram",
  2207051: "Instagram заблокировал запрос",
  2207053: "видео превысило ограничения Instagram (300 МБ, 1920 px или 25 Мбит/с)",
  2207057: "неверный кадр обложки",
  2207077: "Instagram не смог скачать видео",
  2207085: "формат, длительность или разрешение видео не подходят",
  36001: "максимальное разрешение — 1920×1080",
  36003: "соотношение сторон вне допустимого",
};

/** Ошибки доступа: обновление токена не спасёт, нужен повторный вход. */
function metaNeedsReconnect(code?: number, sub?: number, message?: string): string | null {
  if (code === 190 && sub === 459) {
    return "Instagram требует подтвердить вход: зайдите в приложение Instagram, пройдите проверку безопасности и подключите аккаунт заново";
  }
  if (code === 190 && sub === 492) return "у аккаунта больше нет прав на эту страницу";
  if (code === 190 || code === 102 || sub === 33) return "доступ истёк или отозван";
  if (code === 10 || code === 200) return "не хватает разрешений — переподключите аккаунт и разрешите публикацию";
  if (message && /session (key is malformed|has been invalidated)|till you log in to/i.test(message)) {
    return "сессия Instagram недействительна";
  }
  return null;
}

/** Ошибка Graph API → понятный текст и решение, что с ней делать. */
export function metaError(
  prefix: string,
  status: number,
  e?: MetaError,
  retryAfterMs?: number
): PlatformError {
  const code = e?.code;
  const sub = e?.error_subcode;
  const raw = e?.error_user_msg || e?.message || `HTTP ${status}`;

  const reconnect = metaNeedsReconnect(code, sub, e?.message);
  if (reconnect) {
    return new PlatformError(
      `${prefix}: ${reconnect} — переподключите Instagram на странице «Аккаунты»`,
      "reconnect"
    );
  }

  // Видео ещё обрабатывается — это нормальный промежуточный ответ.
  if (code === 9007 || sub === 2207027 || sub === 2207052 || sub === 2207082 || code === 9004) {
    return new PlatformError(`${prefix}: видео ещё обрабатывается`, "retry", retryAfterMs ?? 15_000);
  }

  if (sub && META_PERMANENT[sub]) {
    return new PlatformError(`${prefix}: ${META_PERMANENT[sub]}`, "permanent");
  }
  if (code && META_PERMANENT[code]) {
    return new PlatformError(`${prefix}: ${META_PERMANENT[code]}`, "permanent");
  }

  if ((code && META_RATE_LIMIT.has(code)) || status === 429) {
    return new PlatformError(
      `${prefix}: превышена частота обращений к Instagram, подождём и попробуем снова`,
      "retry",
      retryAfterMs ?? 15 * 60_000
    );
  }
  if (
    e?.is_transient ||
    (code && META_TRANSIENT.has(code)) ||
    status >= 500 ||
    /unknown error occurred|something went wrong/i.test(raw)
  ) {
    return new PlatformError(`${prefix}: временный сбой Instagram (${raw})`, "retry", retryAfterMs);
  }
  return new PlatformError(`${prefix}: ${raw}`, isRetryableStatus(status));
}

/**
 * Насколько израсходован лимит обращений к Meta (заголовки x-app-usage и
 * x-business-use-case-usage). Подходим к потолку — притормаживаем сами, не
 * дожидаясь блокировки.
 */
export function metaUsagePercent(headers: Headers): number {
  let worst = 0;
  const consider = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const key of ["call_count", "total_time", "total_cputime"]) {
      const v = Number((o as Record<string, unknown>)[key]);
      if (Number.isFinite(v)) worst = Math.max(worst, v);
    }
  };
  try {
    const app = headers.get("x-app-usage");
    if (app) consider(JSON.parse(app));
    const business = headers.get("x-business-use-case-usage");
    if (business) {
      for (const list of Object.values(JSON.parse(business) as Record<string, unknown[]>)) {
        for (const entry of list ?? []) consider(entry);
      }
    }
  } catch {
    /* заголовка нет или он не разобрался — считаем, что запас есть */
  }
  return worst;
}

// --- TikTok ----------------------------------------------------------------

const TIKTOK_PERMANENT: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "приложение ещё не прошло аудит TikTok — публиковать можно только приватно",
  privacy_level_option_mismatch: "выбранный уровень приватности недоступен этому аккаунту",
  invalid_param: "TikTok отклонил параметры запроса",
  invalid_params: "TikTok отклонил параметры запроса",
  scope_not_authorized: "не выдано разрешение на публикацию",
  scope_permission_missed: "не выдано разрешение на публикацию",
  url_ownership_unverified: "домен ссылки не подтверждён в кабинете TikTok",
  file_format_check_failed: "TikTok не принял формат файла",
  duration_check_failed: "длительность видео вне допустимого для этого аккаунта",
  frame_rate_check_failed: "частота кадров вне допустимой",
  picture_size_check_failed: "размер изображения больше 1080 px по короткой стороне",
  invalid_file_upload: "TikTok не принял загруженный файл",
  video_pull_failed: "TikTok не смог скачать видео",
  photo_pull_failed: "TikTok не смог скачать изображение",
  app_version_check_failed: "обновите приложение TikTok на телефоне",
  spam_risk_text: "TikTok счёл текст спамом",
  spam_risk_too_many_posts: "достигнут дневной лимит публикаций TikTok",
  spam_risk_too_many_pending_share:
    "во входящих TikTok слишком много неопубликованных видео (максимум 5 за сутки) — опубликуйте или удалите их в приложении",
  spam_risk_user_banned_from_posting: "аккаунту запрещено публиковать",
  spam_risk: "TikTok счёл публикацию подозрительной",
};

const TIKTOK_RECONNECT: Record<string, string> = {
  access_token_invalid: "доступ истёк",
  scope_not_authorized: "не выдано разрешение на публикацию",
  reached_active_user_cap:
    "приложение TikTok достигло дневного лимита пользователей — обновление токена не поможет",
};

export function tiktokError(prefix: string, status: number, code?: string, message?: string): PlatformError {
  if (code && TIKTOK_RECONNECT[code] && code !== "scope_not_authorized") {
    return new PlatformError(
      `${prefix}: ${TIKTOK_RECONNECT[code]} — переподключите TikTok на странице «Аккаунты»`,
      "reconnect"
    );
  }
  if (code && TIKTOK_PERMANENT[code]) {
    return new PlatformError(`${prefix}: ${TIKTOK_PERMANENT[code]}`, "permanent");
  }
  if (code === "rate_limit_exceeded") {
    return new PlatformError(`${prefix}: TikTok просит подождать`, "retry", 15 * 60_000);
  }
  if (code === "internal" || status >= 500) {
    return new PlatformError(`${prefix}: временный сбой TikTok`, "retry");
  }
  return new PlatformError(`${prefix}: ${message || code || `HTTP ${status}`}`, isRetryableStatus(status));
}

// --- YouTube ---------------------------------------------------------------

/** Квота Google приходит как 403, а не 429: различаем по полю reason. */
const YT_QUOTA = new Set(["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"]);
const YT_THROTTLE = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const YT_RECONNECT = new Set(["authError", "authenticationFailure", "UNAUTHENTICATED", "invalid_grant"]);

/** Когда у Google обнулится дневная квота — полночь по тихоокеанскому времени. */
export function nextYoutubeQuotaReset(now = new Date()): Date {
  const pacificNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const shift = now.getTime() - pacificNow.getTime();
  const nextMidnightPacific = new Date(pacificNow);
  nextMidnightPacific.setHours(24, 0, 0, 0);
  return new Date(nextMidnightPacific.getTime() + shift);
}

export function youtubeError(status: number, reason: string | undefined, message: string): PlatformError {
  if (reason && YT_RECONNECT.has(reason)) {
    return new PlatformError(
      "YouTube: доступ отозван или истёк — переподключите канал на странице «Аккаунты»",
      "reconnect"
    );
  }
  if (reason && YT_QUOTA.has(reason)) {
    const reset = nextYoutubeQuotaReset();
    return new PlatformError(
      `YouTube: исчерпана дневная квота загрузок. Она обновится ${reset.toLocaleString("ru-RU")} — попробуйте после этого`,
      "permanent"
    );
  }
  if (reason && YT_THROTTLE.has(reason)) {
    return new PlatformError("YouTube: слишком частые обращения, подождём и повторим", "retry", 60_000);
  }
  if (reason === "youtubeSignupRequired") {
    return new PlatformError("YouTube: у аккаунта Google нет канала", "permanent");
  }
  if (reason && /^invalid(Title|Description|CategoryId|VideoMetadata|Filename)/.test(reason)) {
    return new PlatformError(`YouTube отклонил данные публикации: ${message}`, "permanent");
  }
  return new PlatformError(`YouTube: ${message}`, isRetryableStatus(status));
}
