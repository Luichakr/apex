/**
 * Коннектор LinkedIn (Posts API + Videos API).
 *
 * Для публикации в свой профиль достаточно self-serve продукта
 * «Share on LinkedIn» — партнёрское одобрение не нужно. Доступ выдаётся
 * правом w_member_social.
 *
 * Загрузка видео идёт в три шага (Videos API):
 *   1. initializeUpload — регистрируем файл, получаем части по 4 МБ и URN;
 *   2. PUT каждой части на выданный URL, собираем ETag'и;
 *   3. finalizeUpload — связываем части по ETag'ам;
 *   далее Posts API публикует пост со ссылкой на видео-URN.
 *
 * Все запросы к api.linkedin.com несут версию (LinkedIn-Version) и протокол
 * Rest.li 2.0.0 — без них API отвечает ошибкой.
 */
import { open, stat } from "node:fs/promises";
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
import { updateStoredTokens } from "../accounts";
import { httpError, PlatformError } from "./errors";
import { truncateChars, CAPTION_LIMITS } from "../limits";

const AUTH_BASE = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com";
// Месяц версии API. LinkedIn выводит старые версии из строя, поэтому держим
// значение на виду и обновляем, когда LinkedIn объявляет о закрытии.
const API_VERSION = "202609";
const SCOPES = ["openid", "profile", "w_member_social"];
const PART_SIZE = 4 * 1024 * 1024; // требование LinkedIn: части по 4 МБ

function redirectUri(): string {
  return new URL("/api/connect/linkedin/callback", getEnv().APP_URL).toString();
}

function liHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

export const linkedinProvider: SocialProvider = {
  id: "LINKEDIN",

  getAuthUrl(state: string): string {
    const env = getEnv();
    const url = new URL(AUTH_BASE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  },

  async handleCallback(code: string): Promise<ConnectResult> {
    const env = getEnv();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: env.LINKEDIN_CLIENT_ID!,
        client_secret: env.LINKEDIN_CLIENT_SECRET!,
      }),
      cache: "no-store",
    });
    const token = await res.json().catch(() => ({}));
    if (!res.ok || !token.access_token) {
      throw new Error(`LinkedIn OAuth: ${token.error_description ?? token.error ?? res.statusText}`);
    }

    // Профиль автора: id (sub) нужен как urn:li:person:{sub}.
    const me = await (
      await fetch(`${API}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
      })
    ).json();
    const sub: string | undefined = me?.sub;
    if (!sub) throw new Error("LinkedIn: не удалось получить идентификатор профиля");

    return {
      providerAccountId: sub,
      displayName: me.name ? String(me.name) : "LinkedIn",
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? undefined,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
      scope: token.scope ?? SCOPES.join(" "),
      meta: { personUrn: `urn:li:person:${sub}` },
    };
  },

  async ensureFreshToken(account: DecryptedAccount): Promise<DecryptedAccount> {
    const stillValid =
      account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() > 3 * 86_400_000;
    if (stillValid || !account.refreshToken) return account;

    const env = getEnv();
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID!,
        client_secret: env.LINKEDIN_CLIENT_SECRET!,
      }),
      cache: "no-store",
    });
    const token = await res.json().catch(() => ({}));
    if (!res.ok || !token.access_token) {
      // Токен ещё жив — публикуем им; истёк — честно просим переподключить.
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now()) return account;
      throw new PlatformError(
        "LinkedIn: доступ истёк — переподключите аккаунт на странице «Аккаунты»",
        "reconnect"
      );
    }
    const updated: DecryptedAccount = {
      ...account,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? account.refreshToken,
      tokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : account.tokenExpiresAt,
    };
    await updateStoredTokens(account, {
      accessToken: updated.accessToken,
      refreshToken: updated.refreshToken,
      expiresAt: updated.tokenExpiresAt,
    });
    return updated;
  },

  async publish(account: DecryptedAccount, input: PublishInput): Promise<PublishResult> {
    const token = account.accessToken;
    const author = String(account.meta?.personUrn ?? `urn:li:person:${account.providerAccountId}`);
    const size = (await stat(input.filePath)).size;

    // Повтор после сбоя: видео уже загружено прошлой попыткой — не льём заново.
    let videoUrn = input.remoteId ?? null;
    if (!videoUrn) {
      videoUrn = await uploadVideo(token, author, input, size);
      await input.saveRemoteId?.(videoUrn);
    }

    await input.onStage?.("processing");
    const visibility =
      input.settings?.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC";
    const text = truncateChars(input.caption ?? "", CAPTION_LIMITS.LINKEDIN);

    const res = await fetch(`${API}/rest/posts`, {
      method: "POST",
      headers: { ...liHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        author,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: { media: { id: videoUrn } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw httpError("LinkedIn publish", res.status, liMessage(body));
    }
    // Id поста LinkedIn отдаёт заголовком.
    const postUrn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? videoUrn;
    const activity = postUrn.match(/urn:li:(?:share|ugcPost|activity):(\d+)/)?.[1];
    return {
      externalId: postUrn,
      externalUrl: activity
        ? `https://www.linkedin.com/feed/update/${postUrn}`
        : undefined,
    };
  },

  async fetchMetrics(
    account: DecryptedAccount,
    target: MetricsTarget
  ): Promise<FetchedMetrics | null> {
    // Для личного профиля охват LinkedIn не отдаёт — только счётчики реакций.
    // socialActions возвращает их по URN поста разом.
    const token = account.accessToken;
    const urn = encodeURIComponent(target.externalId);
    const res = await fetch(`${API}/rest/socialActions/${urn}`, {
      headers: liHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 бывает в первые минуты после публикации — считаем «ещё нет данных».
      if (res.status === 404) return null;
      throw httpError("LinkedIn insights", res.status, liMessage(await res.text().catch(() => "")));
    }
    const json = (await res.json().catch(() => ({}))) as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { aggregatedTotalComments?: number; totalFirstLevelComments?: number };
    };
    return {
      likes: json.likesSummary?.totalLikes,
      comments:
        json.commentsSummary?.aggregatedTotalComments ??
        json.commentsSummary?.totalFirstLevelComments,
      raw: json,
    };
  },
};

/** Полная загрузка видео: init → PUT частей → finalize. Возвращает URN. */
async function uploadVideo(
  token: string,
  author: string,
  input: PublishInput,
  size: number
): Promise<string> {
  // 1. Регистрируем загрузку.
  const initRes = await fetch(`${API}/rest/videos?action=initializeUpload`, {
    method: "POST",
    headers: { ...liHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      initializeUploadRequest: { owner: author, fileSizeBytes: size },
    }),
    cache: "no-store",
  });
  const init = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !init.value?.video) {
    throw httpError("LinkedIn init", initRes.status, liMessage(JSON.stringify(init)));
  }
  const videoUrn: string = init.value.video;
  const parts: { uploadUrl: string; firstByte: number; lastByte: number }[] =
    init.value.uploadInstructions ?? [];
  const uploadToken: string = init.value.uploadToken ?? "";
  if (parts.length === 0) throw new PlatformError("LinkedIn: не выдан адрес загрузки", true);

  // 2. Льём части, собираем ETag'и строго по порядку.
  const etags: string[] = [];
  const fh = await open(input.filePath, "r");
  try {
    for (const part of parts) {
      const length = part.lastByte - part.firstByte + 1;
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, part.firstByte);
      let etag: string | null = null;
      for (let attempt = 0; attempt < 4 && !etag; attempt++) {
        const put = await fetch(part.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(buf),
        }).catch(() => null);
        if (put && put.ok) etag = put.headers.get("etag");
        else if (put && put.status < 500 && put.status !== 429) {
          throw httpError("LinkedIn upload", put.status);
        } else await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
      }
      if (!etag) throw new PlatformError("LinkedIn: часть видео не загрузилась", true);
      etags.push(etag);
    }
  } finally {
    await fh.close();
  }

  // 3. Финализируем.
  const finRes = await fetch(`${API}/rest/videos?action=finalizeUpload`, {
    method: "POST",
    headers: { ...liHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: etags },
    }),
    cache: "no-store",
  });
  if (!finRes.ok) {
    const body = await finRes.text().catch(() => "");
    throw httpError("LinkedIn finalize", finRes.status, liMessage(body));
  }
  return videoUrn;
}

/** Достаём человекочитаемое сообщение из ответа LinkedIn. */
function liMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string };
    return j.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
