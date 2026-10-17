/**
 * Коннектор TikTok (Content Posting API).
 *
 * Без аудита приложения доступен режим inbox/FILE_UPLOAD (scope video.upload):
 * видео загружается в раздел черновиков пользователя, а публикует он его сам
 * в приложении. Это безопасно и не требует долгого аудита.
 *
 * Загрузка файла — чанками, по правилам TikTok (одиночный чанк до 64 МБ,
 * иначе части по 32 МБ, последняя забирает остаток).
 */
import { open, stat } from "node:fs/promises";
import type {
  ConnectResult,
  DecryptedAccount,
  PublishInput,
  PublishResult,
  SocialProvider,
} from "./types";
import { getEnv } from "../env";
import { updateStoredTokens } from "../accounts";
import { httpError, PlatformError, tiktokError } from "./errors";

const AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.upload"];

const MAX_SINGLE = 64 * 1024 * 1024;
const MULTI_CHUNK = 32 * 1024 * 1024;

function redirectUri(): string {
  return new URL("/api/connect/tiktok/callback", getEnv().APP_URL).toString();
}

export const tiktokProvider: SocialProvider = {
  id: "TIKTOK",

  getAuthUrl(state: string): string {
    const env = getEnv();
    const url = new URL(AUTH_BASE);
    url.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY!);
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    return url.toString();
  },

  async handleCallback(code: string): Promise<ConnectResult> {
    const env = getEnv();
    const tokenRes = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
      }),
      cache: "no-store",
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || token.error) {
      throw new Error(
        `TikTok OAuth: ${token.error_description ?? token.error ?? tokenRes.statusText}`
      );
    }

    const accessToken: string = token.access_token;
    const openId: string = token.open_id;

    // Имя пользователя для отображения.
    let displayName = "TikTok";
    try {
      const infoRes = await fetch(
        `${API}/user/info/?fields=open_id,display_name`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
      const info = await infoRes.json();
      if (info?.data?.user?.display_name) displayName = info.data.user.display_name;
    } catch {
      /* необязательно */
    }

    return {
      providerAccountId: openId,
      displayName,
      accessToken,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : undefined,
      scope: token.scope ?? SCOPES.join(","),
      meta: { openId },
    };
  },

  async ensureFreshToken(account: DecryptedAccount): Promise<DecryptedAccount> {
    const stillValid =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - Date.now() > 120_000;
    if (stillValid || !account.refreshToken) return account;

    const env = getEnv();
    const res = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      }),
      cache: "no-store",
    });
    const token = await res.json().catch(() => ({}));
    if (!res.ok || token.error || !token.access_token) {
      throw new PlatformError(
        "TikTok: доступ истёк или отозван — переподключите TikTok на странице «Аккаунты»",
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

  async publish(
    account: DecryptedAccount,
    input: PublishInput
  ): Promise<PublishResult> {
    const auth = {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    };

    // Повтор: если прошлая попытка уже загрузила файл — не дублируем черновик.
    if (input.remoteId) {
      const st = await fetchStatus(input.remoteId, auth).catch(() => null);
      if (st && st.status !== "FAILED") {
        if (st.status !== "SEND_TO_USER_INBOX" && st.status !== "PUBLISH_COMPLETE") {
          await waitForInbox(input.remoteId, auth);
        }
        return { externalId: input.remoteId, draft: true };
      }
    }

    // У каждого аккаунта свой предел длительности, и он зависит от статуса
    // аудита приложения. Спрашиваем до загрузки, чтобы не лить мегабайты зря.
    const limits = await creatorLimits(auth);
    if (limits?.maxDurationSec && input.durationSec && input.durationSec > limits.maxDurationSec) {
      throw new PlatformError(
        `TikTok: видео ${Math.round(input.durationSec)} с, а этому аккаунту разрешено не больше ${limits.maxDurationSec} с`,
        "permanent"
      );
    }

    const size = (await stat(input.filePath)).size;
    const chunkSize = size <= MAX_SINGLE ? size : MULTI_CHUNK;
    const totalChunks = size <= MAX_SINGLE ? 1 : Math.floor(size / chunkSize);

    // 1. Инициализация загрузки во входящие (inbox) TikTok.
    const initRes = await fetch(`${API}/post/publish/inbox/video/init/`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      }),
      cache: "no-store",
    });
    const init = await initRes.json().catch(() => ({}));
    if (!initRes.ok || init.error?.code !== "ok") {
      throw tiktokError("TikTok", initRes.status, init.error?.code, init.error?.message);
    }
    const uploadUrl: string = init.data.upload_url;
    const publishId: string = init.data.publish_id;
    await input.saveRemoteId?.(publishId);

    // 2. Загрузка чанков (последний забирает остаток).
    const fh = await open(input.filePath, "r");
    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
        const length = end - start + 1;
        const buffer = Buffer.alloc(length);
        await fh.read(buffer, 0, length, start);

        let ok = false;
        for (let tryN = 0; tryN < 4 && !ok; tryN++) {
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(length),
              "Content-Range": `bytes ${start}-${end}/${size}`,
            },
            body: buffer,
          }).catch(() => null);
          if (putRes && (putRes.ok || putRes.status === 206)) ok = true;
          else if (putRes && putRes.status < 500 && putRes.status !== 429) {
            throw httpError(`TikTok upload (часть ${i + 1})`, putRes.status);
          } else await new Promise((r) => setTimeout(r, 2 ** tryN * 2000));
        }
        if (!ok) throw new PlatformError(`TikTok upload: часть ${i + 1} не загрузилась`, true);
      }
    } finally {
      await fh.close();
    }

    // 3. Ждём, пока TikTok обработает видео и положит его во входящие.
    await input.onStage?.("processing");
    await waitForInbox(publishId, auth);
    return { externalId: publishId, draft: true };
  },

  async revoke(account: DecryptedAccount): Promise<void> {
    const env = getEnv();
    await fetch(`${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        token: account.accessToken,
      }),
    }).catch(() => {});
  },
};

type TikTokStatus = { status: string; fail_reason?: string };

async function fetchStatus(
  publishId: string,
  headers: Record<string, string>
): Promise<TikTokStatus> {
  const res = await fetch(`${API}/post/publish/status/fetch/`, {
    method: "POST",
    headers,
    body: JSON.stringify({ publish_id: publishId }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error?.code !== "ok") {
    throw tiktokError("TikTok", res.status, j.error?.code, j.error?.message);
  }
  return j.data as TikTokStatus;
}

/** Опрос статуса до попадания видео во входящие (или явной ошибки TikTok). */
async function waitForInbox(publishId: string, headers: Record<string, string>): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const st = await fetchStatus(publishId, headers).catch(() => null);
    if (st?.status === "SEND_TO_USER_INBOX" || st?.status === "PUBLISH_COMPLETE") return;
    if (st?.status === "FAILED") {
      // fail_reason — тот же словарь кодов, что и у ошибок запроса.
      throw tiktokError("TikTok отклонил видео", 400, st.fail_reason, st.fail_reason);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  // Файл загружен, обработка затянулась — не дублируем, считаем отправленным.
}

/**
 * Что этот аккаунт вообще может опубликовать. Ответ не кешируем: набор
 * зависит от статуса аудита приложения и настроек творца. Сбой запроса
 * публикацию не отменяет — это лишь предварительная проверка.
 */
async function creatorLimits(
  headers: Record<string, string>
): Promise<{ maxDurationSec?: number } | null> {
  try {
    const res = await fetch(`${API}/post/publish/creator_info/query/`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error?.code !== "ok") return null;
    const max = Number(j.data?.max_video_post_duration_sec);
    return { maxDurationSec: Number.isFinite(max) && max > 0 ? max : undefined };
  } catch {
    return null;
  }
}
