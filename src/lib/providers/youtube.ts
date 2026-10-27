/**
 * Коннектор YouTube (YouTube Data API v3) через googleapis.
 *
 * Поток: OAuth (offline, с refresh-токеном) → сохраняем токены → загрузка видео
 * методом videos.insert по протоколу resumable upload: файл идёт частями по
 * 32 МБ, обрыв связи продолжает загрузку с места остановки, а повтор задачи
 * продолжает ту же сессию — дубль видео на канале не появится.
 */
import { open, stat } from "node:fs/promises";
import { google } from "googleapis";
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
import {
  sanitizeYoutube,
  truncateBytes,
  truncateChars,
  youtubeTitleFrom,
  YOUTUBE_DESCRIPTION_BYTES,
  YOUTUBE_TITLE_LIMIT,
} from "../limits";
import { httpError, PlatformError, youtubeError } from "./errors";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // Лайки и комментарии друзьям. У каналов, подключённых раньше, этого права
  // нет — им покажем просьбу переподключить канал.
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

function supportFail(res: Response, text: string): PlatformError {
  if (res.status === 403 && /insufficient|scope/i.test(text)) {
    return new PlatformError(
      "YouTube: у канала нет права на лайки и комментарии — переподключите канал на странице «Аккаунты»",
      "reconnect"
    );
  }
  return youtubeError(res.status, undefined, text.slice(0, 200) || `HTTP ${res.status}`);
}

function redirectUri(): string {
  return new URL("/api/connect/youtube/callback", getEnv().APP_URL).toString();
}

function oauthClient() {
  const env = getEnv();
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

export const youtubeProvider: SocialProvider = {
  id: "YOUTUBE",

  getAuthUrl(state: string): string {
    return oauthClient().generateAuthUrl({
      access_type: "offline", // чтобы получить refresh_token
      prompt: "consent", // гарантирует выдачу refresh_token
      scope: SCOPES,
      state,
      include_granted_scopes: true,
    });
  },

  async handleCallback(code: string): Promise<ConnectResult> {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      throw new Error("YouTube: не получен access_token");
    }
    client.setCredentials(tokens);

    // Узнаём канал, чтобы показать его имя пользователю.
    const youtube = google.youtube({ version: "v3", auth: client });
    const channels = await youtube.channels.list({
      part: ["snippet"],
      mine: true,
    });
    const channel = channels.data.items?.[0];
    const channelId = channel?.id ?? "unknown";
    const channelTitle = channel?.snippet?.title ?? "YouTube-канал";

    return {
      providerAccountId: channelId,
      displayName: channelTitle,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      scope: tokens.scope ?? SCOPES.join(" "),
      meta: { channelId, channelTitle },
    };
  },

  async ensureFreshToken(account: DecryptedAccount): Promise<DecryptedAccount> {
    // Если токен ещё жив (с запасом 2 минуты) — ничего не делаем.
    const stillValid =
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - Date.now() > 120_000;
    if (stillValid) return account;
    if (!account.refreshToken) return account; // нечем обновлять

    const client = oauthClient();
    client.setCredentials({ refresh_token: account.refreshToken });
    let credentials;
    try {
      ({ credentials } = await client.refreshAccessToken());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // invalid_grant = доступ отозван/истёк: повтор не поможет.
      const dead = /invalid_grant|unauthorized/i.test(msg);
      throw new PlatformError(
        dead
          ? "YouTube: доступ отозван или истёк — переподключите канал на странице «Аккаунты»"
          : `YouTube: не удалось обновить доступ (${msg})`,
        dead ? "reconnect" : "retry"
      );
    }
    if (!credentials.access_token) return account;

    const updated: DecryptedAccount = {
      ...account,
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? account.refreshToken,
      tokenExpiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
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
    // Заголовок YouTube: первая строка текста (до 100), описание — весь текст.
    // YouTube запрещает символы < и > — заменяем на похожие.
    const fromCaption = youtubeTitleFrom(input.caption ?? "");
    const title =
      truncateChars(sanitizeYoutube(input.title || fromCaption || "Видео"), YOUTUBE_TITLE_LIMIT) ||
      "Видео";
    const description = truncateBytes(
      sanitizeYoutube(input.caption ?? ""),
      YOUTUBE_DESCRIPTION_BYTES
    );
    const set = input.settings ?? {};
    const privacy = typeof set.privacy === "string" ? set.privacy : "public";
    const id = await resumableUpload(
      account.accessToken,
      input,
      {
        snippet: {
          title,
          description,
          categoryId: typeof set.categoryId === "string" ? set.categoryId : "22",
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: set.madeForKids === true,
        },
      },
      privacy === "public" && set.notifySubscribers !== false
    );

    // Обложка ставится ПОСЛЕ загрузки. Если не вышло — видео уже опубликовано,
    // поэтому не роняем публикацию, а только отмечаем это в примечании.
    let note: string | undefined;
    if ((input.coverImagePath || input.coverMs !== null) && input.renderCover) {
      const jpeg = await input.renderCover(1280).catch(() => null);
      if (jpeg) {
        const ok = await setThumbnail(account.accessToken, id, jpeg);
        if (!ok) note = "Видео опубликовано, но обложку YouTube не принял — поставьте её вручную";
      }
    }
    return { externalId: id, externalUrl: `https://youtu.be/${id}`, note };
  },

  async revoke(account: DecryptedAccount): Promise<void> {
    const client = oauthClient();
    await client.revokeToken(account.accessToken).catch(() => {});
  },

  async like(account: DecryptedAccount, externalId: string): Promise<void> {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos/rate");
    url.searchParams.set("id", externalId);
    url.searchParams.set("rating", "like");
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Length": "0" },
      cache: "no-store",
    });
    if (!res.ok) throw supportFail(res, await res.text().catch(() => ""));
  },

  async comment(account: DecryptedAccount, externalId: string, text: string): Promise<void> {
    const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          videoId: externalId,
          topLevelComment: { snippet: { textOriginal: text } },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) throw supportFail(res, await res.text().catch(() => ""));
  },

  async fetchMetrics(
    account: DecryptedAccount,
    target: MetricsTarget
  ): Promise<FetchedMetrics | null> {
    // videos.list со statistics отдаёт просмотры, лайки и комментарии разом.
    // Расходует всего 1 единицу квоты — для сбора метрик это удобно.
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", target.externalId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw await youtubeFail(res);
    const json = (await res.json()) as {
      items?: { statistics?: Record<string, string> }[];
    };
    const s = json.items?.[0]?.statistics;
    if (!s) return null;
    const num = (v: string | undefined) =>
      v === undefined ? undefined : Number.parseInt(v, 10);
    return {
      views: num(s.viewCount),
      likes: num(s.likeCount),
      comments: num(s.commentCount),
      raw: s,
    };
  },
};

// --- Resumable upload (developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)

const UPLOAD_BASE =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHUNK = 32 * 1024 * 1024; // кратно 256 КБ

async function resumableUpload(
  accessToken: string,
  input: PublishInput,
  resource: object,
  notifySubscribers = true
): Promise<string> {
  const size = (await stat(input.filePath)).size;
  const auth = { Authorization: `Bearer ${accessToken}` };

  // Повтор задачи: продолжаем сохранённую сессию, если она жива.
  let session = input.remoteId?.startsWith("https://") ? input.remoteId : null;
  let offset = 0;
  if (session) {
    const st = await queryOffset(session, size, auth);
    if (st.done) return st.done;
    if (st.offset === null) session = null; // сессия истекла — начинаем заново
    else offset = st.offset;
  }

  if (!session) {
    const res = await fetch(`${UPLOAD_BASE}&notifySubscribers=${notifySubscribers}`, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": input.mimeType || "video/mp4",
      },
      body: JSON.stringify(resource),
    });
    if (!res.ok) throw await youtubeFail(res);
    session = res.headers.get("location");
    if (!session) throw new PlatformError("YouTube: не получен адрес загрузки", true);
    await input.saveRemoteId?.(session);
  }

  const fh = await open(input.filePath, "r");
  try {
    let failures = 0;
    while (offset < size) {
      const end = Math.min(offset + CHUNK, size) - 1;
      const buf = Buffer.alloc(end - offset + 1);
      await fh.read(buf, 0, buf.length, offset);
      let res: Response;
      try {
        res = await fetch(session, {
          method: "PUT",
          headers: {
            ...auth,
            "Content-Length": String(buf.length),
            "Content-Range": `bytes ${offset}-${end}/${size}`,
          },
          body: buf,
        });
      } catch {
        res = new Response(null, { status: 599 });
      }
      if (res.status === 200 || res.status === 201) {
        const json = (await res.json()) as { id?: string };
        if (!json.id) throw new PlatformError("YouTube: загрузка не вернула id видео", false);
        return json.id;
      }
      if (res.status === 308) {
        offset = nextOffset(res.headers.get("range"));
        failures = 0;
        continue;
      }
      if (res.status >= 500 || res.status === 599 || res.status === 429) {
        if (++failures > 6) {
          throw new PlatformError("YouTube: сервер не принимает загрузку, попробуем позже", "retry");
        }
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2 ** failures * 1000)));
        const st = await queryOffset(session, size, auth);
        if (st.done) return st.done;
        if (st.offset === null) throw new PlatformError("YouTube: сессия загрузки потеряна", true);
        offset = st.offset;
        continue;
      }
      throw await youtubeFail(res);
    }
    // Все байты отправлены — уточняем итог.
    const st = await queryOffset(session, size, auth);
    if (st.done) return st.done;
    throw new PlatformError("YouTube: загрузка не завершилась", true);
  } finally {
    await fh.close();
  }
}

function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

async function queryOffset(
  session: string,
  size: number,
  auth: Record<string, string>
): Promise<{ done?: string; offset: number | null }> {
  const res = await fetch(session, {
    method: "PUT",
    headers: { ...auth, "Content-Length": "0", "Content-Range": `bytes */${size}` },
  }).catch(() => null);
  if (!res) return { offset: 0 };
  if (res.status === 200 || res.status === 201) {
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { done: json.id, offset: size };
  }
  if (res.status === 308) return { offset: nextOffset(res.headers.get("range")) };
  return { offset: null };
}

/**
 * Разбор ответа об ошибке YouTube. Квоту Google отдаёт как 403, поэтому решение
 * принимается по полю reason, а не по HTTP-коду.
 */
async function youtubeFail(res: Response): Promise<PlatformError> {
  const text = await res.text().catch(() => "");
  let reason: string | undefined;
  let message = text.slice(0, 300) || `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] };
    };
    reason = j.error?.errors?.[0]?.reason ?? j.error?.status;
    if (j.error?.message) message = j.error.message;
  } catch {
    /* не JSON — оставляем как есть */
  }
  return youtubeError(res.status, reason, message);
}

/** Установить обложку. Возвращает false, если YouTube её не принял. */
async function setThumbnail(accessToken: string, videoId: string, jpeg: Buffer): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/jpeg" },
        body: new Uint8Array(jpeg),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
