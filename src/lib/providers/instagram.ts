/**
 * Коннектор Instagram через «Instagram API с входом через Instagram»
 * (Instagram Login) — пользователь входит своим профессиональным аккаунтом
 * Instagram напрямую, без Страницы Facebook и без бизнес-верификации (для своего
 * аккаунта в режиме тестирования).
 *
 * Использует ОТДЕЛЬНЫЕ ключи: INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET.
 * Публикация: контейнер REELS из публичного URL видео → media_publish.
 */
import type {
  ConnectResult,
  DecryptedAccount,
  FetchedMetrics,
  MetricsTarget,
  PublishInput,
  PublishResult,
  SocialProvider,
} from "./types";
import { getEnv } from "../env";
import { publicMediaUrl } from "../media";
import { parseCollaborators } from "../publish-settings";
import { updateStoredTokens } from "../accounts";
import { metaError, metaUsagePercent, parseRetryAfter, PlatformError } from "./errors";

const AUTH_BASE = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

function redirectUri(): string {
  return new URL("/api/connect/instagram/callback", getEnv().APP_URL).toString();
}

export const instagramProvider: SocialProvider = {
  id: "INSTAGRAM",

  getAuthUrl(state: string): string {
    const env = getEnv();
    const url = new URL(AUTH_BASE);
    url.searchParams.set("client_id", env.INSTAGRAM_APP_ID!);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  },

  async handleCallback(code: string): Promise<ConnectResult> {
    const env = getEnv();

    // 1. Код -> короткоживущий токен (+ user_id).
    const form = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID!,
      client_secret: env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code: code.replace(/#_$/, ""), // Instagram иногда добавляет #_ в конец
    });
    const shortRes = await fetch(TOKEN_URL, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    const short = await shortRes.json();
    if (!shortRes.ok || short.error_type || !short.access_token) {
      throw new Error(
        `Instagram OAuth: ${short.error_message ?? short.error ?? shortRes.statusText}`
      );
    }
    const igUserId = String(short.user_id);

    // 2. -> долгоживущий токен (~60 дней).
    const longUrl = new URL(`${GRAPH}/access_token`);
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", env.INSTAGRAM_APP_SECRET!);
    longUrl.searchParams.set("access_token", short.access_token);
    const longRes = await fetch(longUrl, { cache: "no-store" });
    const long = await longRes.json().catch(() => ({}));
    if (!longRes.ok || !long.access_token) {
      // Короткий токен живёт час и не продлевается — без долгого работать нельзя.
      throw new Error(
        `Instagram: не удалось получить долгоживущий токен (${long.error?.message ?? longRes.statusText})`
      );
    }
    const accessToken: string = long.access_token;
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000)
      : undefined;

    // 3. Имя пользователя и ПРАВИЛЬНЫЙ id для публикации (user_id из /me).
    let username = "Instagram";
    let publishId = igUserId;
    try {
      const meUrl = new URL(`${GRAPH}/${API_V}/me`);
      meUrl.searchParams.set("fields", "user_id,username");
      meUrl.searchParams.set("access_token", accessToken);
      const me = await (await fetch(meUrl, { cache: "no-store" })).json();
      if (me?.username) username = `@${me.username}`;
      if (me?.user_id) publishId = String(me.user_id);
    } catch {
      /* необязательно */
    }

    return {
      providerAccountId: publishId,
      displayName: username,
      accessToken,
      expiresAt,
      scope: SCOPES.join(","),
      meta: { igUserId: publishId },
    };
  },

  async ensureFreshToken(account: DecryptedAccount): Promise<DecryptedAccount> {
    const stillValid =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - Date.now() > 3 * 86_400_000; // >3 дней
    if (stillValid) return account;

    try {
      const url = new URL(`${GRAPH}/refresh_access_token`);
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", account.accessToken);
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.access_token) {
        // Токен ещё жив — публикуем им; истёк — честно просим переподключить.
        if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now()) return account;
        throw new PlatformError(
          "Instagram: доступ истёк — переподключите Instagram на странице «Аккаунты»",
          false
        );
      }
      const updated: DecryptedAccount = {
        ...account,
        accessToken: json.access_token,
        tokenExpiresAt: json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000)
          : account.tokenExpiresAt,
      };
      await updateStoredTokens(account, {
        accessToken: updated.accessToken,
        expiresAt: updated.tokenExpiresAt,
      });
      return updated;
    } catch (e) {
      if (e instanceof PlatformError) throw e;
      return account;
    }
  },

  async publish(
    account: DecryptedAccount,
    input: PublishInput
  ): Promise<PublishResult> {
    const igUserId = String(account.meta?.igUserId ?? account.providerAccountId);
    const token = account.accessToken;

    // Повтор после сбоя: смотрим, что стало с контейнером прошлой попытки.
    let creationId: string | null = null;
    if (!input.remoteId && (input.attempt ?? 1) > 1) {
      // Связь могла оборваться уже ПОСЛЕ того, как Instagram принял запрос:
      // id контейнера мы тогда не сохранили. Прежде чем слать видео снова,
      // проверяем, не появился ли Reels от прошлой попытки — иначе будет дубль.
      const recent = await findRecentMedia(igUserId, token, input.notBefore).catch(() => null);
      if (recent) return recent;
    }
    if (input.remoteId) {
      const st = await containerStatus(input.remoteId, token).catch(() => null);
      if (st === "PUBLISHED") {
        const recent = await findRecentMedia(igUserId, token, input.notBefore);
        if (recent) return recent;
      } else if (st === "FINISHED" || st === "IN_PROGRESS") {
        creationId = input.remoteId;
      }
    }

    const collaborators = parseCollaborators(input.settings?.collaborators).names;

    // 1. Контейнер REELS из публичного URL подготовленной версии видео.
    if (!creationId) {
      const createRes = await fetch(`${GRAPH}/${API_V}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: publicMediaUrl(input.filePath),
          caption: input.caption ?? "",
          share_to_feed: input.settings?.shareToFeed !== false,
          // Соавторы получают приглашение; пост выходит и без их согласия.
          ...(collaborators.length ? { collaborators } : {}),
          // Загруженную картинку Instagram забирает по ссылке, выбранный
          // кадр — по смещению от начала ролика. Картинка главнее.
          ...(input.coverImagePath
            ? { cover_url: publicMediaUrl(input.coverImagePath) }
            : input.coverMs !== null && input.coverMs !== undefined
              ? { thumb_offset: String(Math.round(input.coverMs)) }
              : {}),
          access_token: token,
        }),
        cache: "no-store",
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok || created.error) throw graphError("Instagram", createRes, created.error);
      guardUsage(createRes);
      creationId = String(created.id);
      await input.saveRemoteId?.(creationId);
    }

    // 2. Instagram скачивает и обрабатывает видео (до ~15 минут для длинных).
    await input.onStage?.("processing");
    await waitForContainer(creationId, token);

    // 3. Опубликовать (Instagram иногда отвечает «ещё не готово» — ждём и пробуем снова).
    let published: { id?: string; error?: GraphErr } = {};
    for (let i = 0; i < 6; i++) {
      const pubRes = await fetch(`${GRAPH}/${API_V}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: token }),
        cache: "no-store",
      });
      published = await pubRes.json().catch(() => ({}));
      if (pubRes.ok && published.id) break;
      if (published.error?.code === 9007 || published.error?.is_transient) {
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      throw graphError("Instagram publish", pubRes, published.error);
    }
    if (!published.id) throw new PlatformError("Instagram: видео не готово к публикации", true);
    const mediaId = String(published.id);

    // 4. Постоянная ссылка.
    let url: string | undefined;
    try {
      const permUrl = new URL(`${GRAPH}/${API_V}/${mediaId}`);
      permUrl.searchParams.set("fields", "permalink");
      permUrl.searchParams.set("access_token", token);
      const info = await (await fetch(permUrl, { cache: "no-store" })).json();
      url = info.permalink;
    } catch {
      /* необязательно */
    }
    return { externalId: mediaId, externalUrl: url };
  },

  async fetchMetrics(
    account: DecryptedAccount,
    target: MetricsTarget
  ): Promise<FetchedMetrics | null> {
    // Insights для Reels: reach, likes, comments, shares, saved, views (c 2024).
    const metrics = ["reach", "likes", "comments", "shares", "saved", "views"];
    const url = new URL(`${GRAPH}/${API_V}/${target.externalId}/insights`);
    url.searchParams.set("metric", metrics.join(","));
    url.searchParams.set("access_token", account.accessToken);
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw graphError("Instagram insights", res, json.error);
    const by = new Map<string, number>();
    for (const row of (json.data ?? []) as { name?: string; values?: { value?: number }[] }[]) {
      if (row.name && typeof row.values?.[0]?.value === "number") {
        by.set(row.name, row.values[0].value);
      }
    }
    return {
      views: by.get("views"),
      reach: by.get("reach"),
      likes: by.get("likes"),
      comments: by.get("comments"),
      shares: by.get("shares"),
      saves: by.get("saved"),
      raw: json.data,
    };
  },
};

const API_V = "v21.0";

type GraphErr = {
  message?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_msg?: string;
};

/** Ошибка Graph API → понятный текст и решение (карта кодов — в errors.ts). */
function graphError(prefix: string, res: Response, e?: GraphErr): PlatformError {
  return metaError(prefix, res.status, e, parseRetryAfter(res.headers.get("retry-after")));
}

/**
 * Meta сообщает в заголовках, насколько израсходован лимит обращений. У самого
 * потолка она блокирует аккаунт на часы, поэтому тормозим сами заранее.
 */
function guardUsage(res: Response): void {
  const used = metaUsagePercent(res.headers);
  if (used >= 95) {
    throw new PlatformError(
      `Instagram: почти исчерпан лимит обращений (${Math.round(used)}%) — подождём, чтобы не получить блокировку`,
      "retry",
      30 * 60_000
    );
  }
  if (used >= 80) {
    console.warn(`[instagram] израсходовано ${Math.round(used)}% лимита обращений Meta`);
  }
}

async function containerStatus(
  creationId: string,
  token: string
): Promise<string> {
  const url = new URL(`${GRAPH}/${API_V}/${creationId}`);
  url.searchParams.set("fields", "status_code");
  url.searchParams.set("access_token", token);
  const info = await (await fetch(url, { cache: "no-store" })).json();
  return String(info.status_code ?? "");
}

async function findRecentMedia(
  igUserId: string,
  token: string,
  notBefore?: Date
): Promise<PublishResult | null> {
  const url = new URL(`${GRAPH}/${API_V}/${igUserId}/media`);
  url.searchParams.set("fields", "id,permalink,timestamp,media_product_type");
  url.searchParams.set("limit", "5");
  url.searchParams.set("access_token", token);
  const j = await (await fetch(url, { cache: "no-store" })).json().catch(() => null);
  const items = (j?.data ?? []) as { id: string; permalink?: string; timestamp?: string }[];
  const since = notBefore ? notBefore.getTime() - 60_000 : 0;
  const hit = items.find((m) => m.timestamp && new Date(m.timestamp).getTime() >= since);
  return hit ? { externalId: hit.id, externalUrl: hit.permalink } : null;
}

async function waitForContainer(creationId: string, token: string): Promise<void> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const url = new URL(`${GRAPH}/${API_V}/${creationId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", token);
    const info = await (await fetch(url, { cache: "no-store" })).json().catch(() => ({}));
    const status = info.status_code as string;
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      // Видео отклонено при обработке — повтор с тем же файлом не поможет.
      throw new PlatformError(
        `Instagram отклонил видео при обработке (${status}${info.status ? `: ${info.status}` : ""})`,
        false
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new PlatformError("Instagram: истекло время ожидания обработки видео", true);
}
