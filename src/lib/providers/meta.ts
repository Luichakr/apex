/**
 * Коннектор Meta: Facebook (Страницы) + Instagram (бизнес-аккаунты).
 *
 * Одно подключение (OAuth) даёт доступ ко всем Страницам пользователя и к
 * привязанным к ним бизнес-аккаунтам Instagram. Каждая Страница и каждый IG
 * сохраняются как отдельный аккаунт, который потом выбирается в композере.
 *
 * Публикация:
 *  - Facebook: POST /{page-id}/videos (file_url + description).
 *  - Instagram: 2 шага — создать контейнер REELS из публичного URL, затем media_publish.
 * Для обеих сетей нужен публичный URL видео (publicMediaUrl).
 */
import type { Provider } from "@prisma/client";
import type {
  ConnectResult,
  DecryptedAccount,
  PublishInput,
  PublishResult,
  SocialProvider,
} from "./types";
import { getEnv } from "../env";
import { publicMediaUrl } from "../media";

const GRAPH = "https://graph.facebook.com/v21.0";

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

function redirectUri(): string {
  return new URL("/api/connect/meta/callback", getEnv().APP_URL).toString();
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta API: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

async function graphPost(path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    body,
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta API: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

/** Ссылка авторизации Meta. */
export function metaAuthUrl(state: string): string {
  const env = getEnv();
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", env.META_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/**
 * Обмен кода на доступ и сбор всех доступных аккаунтов (FB-страницы + IG).
 * Возвращает список пар (сеть, данные для сохранения).
 */
export async function metaHandleCallback(
  code: string
): Promise<{ provider: Provider; result: ConnectResult }[]> {
  const env = getEnv();

  // 1. Код -> короткоживущий токен пользователя.
  const short = await graphGet("oauth/access_token", {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    redirect_uri: redirectUri(),
    code,
  });

  // 2. -> долгоживущий токен пользователя (~60 дней).
  const long = await graphGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  const userToken: string = long.access_token;
  const expiresAt = new Date(Date.now() + 55 * 86_400_000); // ~55 дней, с запасом

  // 3. Страницы пользователя + привязанные IG-аккаунты.
  const pages = await graphGet("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userToken,
    limit: "100",
  });

  const out: { provider: Provider; result: ConnectResult }[] = [];
  for (const page of pages.data ?? []) {
    const pageToken: string = page.access_token;
    out.push({
      provider: "FACEBOOK",
      result: {
        providerAccountId: String(page.id),
        displayName: page.name,
        accessToken: pageToken,
        expiresAt,
        scope: SCOPES.join(","),
        meta: { pageId: page.id, pageName: page.name },
      },
    });

    const ig = page.instagram_business_account;
    if (ig?.id) {
      out.push({
        provider: "INSTAGRAM",
        result: {
          providerAccountId: String(ig.id),
          displayName: ig.username ? `@${ig.username}` : "Instagram",
          accessToken: pageToken, // публикация в IG идёт под токеном Страницы
          expiresAt,
          scope: SCOPES.join(","),
          meta: { igUserId: ig.id, pageId: page.id, username: ig.username },
        },
      });
    }
  }

  if (out.length === 0) {
    throw new Error(
      "Не найдено Страниц Facebook. Убедитесь, что у аккаунта есть Страница, а для Instagram — бизнес-аккаунт, привязанный к ней."
    );
  }
  return out;
}

// --- Публикация: Facebook -------------------------------------------------
export const facebookProvider: SocialProvider = {
  id: "FACEBOOK",
  getAuthUrl() {
    throw new Error("Подключение Facebook выполняется через /api/connect/meta");
  },
  async handleCallback(): Promise<ConnectResult> {
    throw new Error("Используйте metaHandleCallback");
  },
  async publish(
    account: DecryptedAccount,
    input: PublishInput
  ): Promise<PublishResult> {
    const pageId = String(account.meta?.pageId ?? account.providerAccountId);
    const res = await graphPost(`${pageId}/videos`, {
      file_url: publicMediaUrl(input.filePath),
      description: input.caption ?? "",
      access_token: account.accessToken,
    });
    const id = String(res.id ?? res.video_id ?? "");
    if (!id) throw new Error("Facebook: публикация не вернула id");
    let url: string | undefined;
    try {
      const info = await graphGet(id, {
        fields: "permalink_url",
        access_token: account.accessToken,
      });
      url = info.permalink_url
        ? info.permalink_url.startsWith("http")
          ? info.permalink_url
          : `https://www.facebook.com${info.permalink_url}`
        : undefined;
    } catch {
      /* ссылка необязательна */
    }
    return { externalId: id, externalUrl: url };
  },
};

// --- Публикация: Instagram (Reels) ---------------------------------------
export const instagramProvider: SocialProvider = {
  id: "INSTAGRAM",
  getAuthUrl() {
    throw new Error("Подключение Instagram выполняется через /api/connect/meta");
  },
  async handleCallback(): Promise<ConnectResult> {
    throw new Error("Используйте metaHandleCallback");
  },
  async publish(
    account: DecryptedAccount,
    input: PublishInput
  ): Promise<PublishResult> {
    const igUserId = String(account.meta?.igUserId ?? account.providerAccountId);
    const token = account.accessToken;

    // 1. Создать контейнер (REELS) из публичного URL видео.
    const container = await graphPost(`${igUserId}/media`, {
      media_type: "REELS",
      video_url: publicMediaUrl(input.filePath),
      caption: input.caption ?? "",
      access_token: token,
    });
    const creationId = String(container.id);

    // 2. Дождаться обработки видео Instagram (до ~5 минут).
    await waitForContainer(creationId, token);

    // 3. Опубликовать.
    const published = await graphPost(`${igUserId}/media_publish`, {
      creation_id: creationId,
      access_token: token,
    });
    const mediaId = String(published.id);

    // 4. Постоянная ссылка.
    let url: string | undefined;
    try {
      const info = await graphGet(mediaId, {
        fields: "permalink",
        access_token: token,
      });
      url = info.permalink;
    } catch {
      /* необязательно */
    }
    return { externalId: mediaId, externalUrl: url };
  },
};

async function waitForContainer(
  creationId: string,
  token: string
): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const info = await graphGet(creationId, {
      fields: "status_code",
      access_token: token,
    });
    const status = info.status_code as string;
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Instagram: обработка видео завершилась статусом ${status}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Instagram: истекло время ожидания обработки видео");
}
