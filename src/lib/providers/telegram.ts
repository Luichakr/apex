/**
 * Коннектор Telegram (Bot API).
 *
 * Telegram устроен иначе остальных площадок: здесь нет OAuth. Пользователь
 * заводит бота у @BotFather и вставляет его токен — поэтому подключение идёт
 * формой, а не переходом на сайт площадки.
 *
 * Два вида назначения, у каждого свои правила:
 *  - канал  (meta.kind = "channel") — sendVideo, бот должен быть админом;
 *  - история (meta.kind = "story")  — postStory от имени бизнес-аккаунта.
 *
 * Истории требуют, чтобы владелец подключил бота в настройках Telegram
 * (Бизнес → Чат-боты) и выдал право «Управление историями». Это возможно
 * только с подпиской Telegram Premium — таково требование самой площадки.
 */
import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import type {
  DecryptedAccount,
  PublishInput,
  PublishResult,
  SocialProvider,
} from "./types";
import { PlatformError } from "./errors";
import { CAPTION_LIMITS, truncateChars } from "../limits";

const API = "https://api.telegram.org";

/** Срок жизни истории: Telegram принимает только эти четыре значения. */
const STORY_PERIODS = new Set([6 * 3600, 12 * 3600, 86400, 2 * 86400]);

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

/** Вызов Bot API. Токен идёт в адресе — наружу его не логируем. */
async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new PlatformError("Telegram: нет связи с сервером", "retry");
  }
  const json = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>;
  if (!json.ok) throw telegramError(method, res.status, json);
  return json.result as T;
}

function telegramError(method: string, status: number, json: TgResponse<unknown>): PlatformError {
  const text = json.description ?? `HTTP ${status}`;
  const retryAfter = json.parameters?.retry_after;

  if (retryAfter) {
    return new PlatformError(
      `Telegram просит подождать ${retryAfter} с перед следующей отправкой`,
      "retry",
      retryAfter * 1000
    );
  }
  if (/unauthorized|token/i.test(text)) {
    return new PlatformError(
      "Telegram: токен бота недействителен — создайте новый у @BotFather и подключите заново",
      "reconnect"
    );
  }
  if (/PREMIUM_ACCOUNT_REQUIRED/i.test(text)) {
    return new PlatformError(
      "Telegram: публикация историй доступна только с подпиской Telegram Premium",
      "permanent"
    );
  }
  if (/BUSINESS_CONNECTION_INVALID|business connection not found/i.test(text)) {
    return new PlatformError(
      "Telegram: бот отключён от бизнес-аккаунта — подключите его заново в настройках Telegram (Бизнес → Чат-боты)",
      "reconnect"
    );
  }
  if (/not enough rights|CHAT_ADMIN_REQUIRED|not a member/i.test(text)) {
    return new PlatformError(
      "Telegram: бот не админ в этом канале — добавьте его администратором с правом публикации",
      "permanent"
    );
  }
  if (/chat not found/i.test(text)) {
    return new PlatformError("Telegram: канал не найден — проверьте его адрес", "permanent");
  }
  if (/too large|file is too big|Request Entity Too Large/i.test(text)) {
    return new PlatformError(
      "Telegram: файл больше того, что принимает бот (50 МБ)",
      "permanent"
    );
  }
  if (status >= 500) return new PlatformError(`Telegram: сбой на стороне площадки (${text})`, "retry");
  return new PlatformError(`Telegram (${method}): ${text}`, status === 429 ? "retry" : "permanent");
}

/** Отправка файла: Bot API принимает multipart. */
async function upload<T>(
  token: string,
  method: string,
  fields: Record<string, string>,
  file: { field: string; path: string; type: string }
): Promise<T> {
  const size = (await stat(file.path)).size;
  const fh = await open(file.path, "r");
  try {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    form.append(file.field, new Blob([new Uint8Array(buf)], { type: file.type }), basename(file.path));

    let res: Response;
    try {
      res = await fetch(`${API}/bot${token}/${method}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20 * 60_000),
      });
    } catch {
      throw new PlatformError("Telegram: загрузка прервалась", "retry");
    }
    const json = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>;
    if (!json.ok) throw telegramError(method, res.status, json);
    return json.result as T;
  } finally {
    await fh.close();
  }
}

// --- Подключение (без OAuth) ------------------------------------------------

export type TelegramBot = {
  id: number;
  username?: string;
  first_name?: string;
  /** Включён ли боту режим работы от имени пользователя (Secretary Mode). */
  can_connect_to_business?: boolean;
};

/** Проверить токен и узнать, что это за бот. */
export async function checkBotToken(token: string): Promise<TelegramBot> {
  return call<TelegramBot>(token, "getMe");
}

/** Проверить канал и права бота в нём. Возвращает название канала. */
export async function checkChannel(token: string, chatId: string): Promise<{ id: number; title: string }> {
  const chat = await call<{ id: number; title?: string; username?: string }>(token, "getChat", {
    chat_id: chatId,
  });
  const me = await call<TelegramBot>(token, "getMe");
  const member = await call<{ status: string; can_post_messages?: boolean }>(
    token,
    "getChatMember",
    { chat_id: chat.id, user_id: me.id }
  );
  if (member.status !== "administrator" && member.status !== "creator") {
    throw new PlatformError(
      "Telegram: бот не администратор этого канала — добавьте его админом с правом публикации",
      "permanent"
    );
  }
  return { id: chat.id, title: chat.title ?? chat.username ?? String(chat.id) };
}

/**
 * Найти бизнес-подключения бота. Telegram сообщает о них отдельным событием,
 * поэтому забираем накопленные события и берём оттуда идентификаторы.
 */
export async function findBusinessConnections(
  token: string
): Promise<{ id: string; title: string; canManageStories: boolean }[]> {
  type Update = {
    business_connection?: {
      id: string;
      user?: { first_name?: string; username?: string };
      rights?: { can_manage_stories?: boolean };
      is_enabled?: boolean;
    };
  };
  const updates = await call<Update[]>(token, "getUpdates", {
    allowed_updates: ["business_connection"],
    limit: 100,
    timeout: 0,
  });
  const found = new Map<string, { id: string; title: string; canManageStories: boolean }>();
  for (const u of updates) {
    const bc = u.business_connection;
    if (!bc || bc.is_enabled === false) continue;
    const name = bc.user?.username ? `@${bc.user.username}` : bc.user?.first_name ?? bc.id;
    found.set(bc.id, {
      id: bc.id,
      title: name,
      canManageStories: bc.rights?.can_manage_stories === true,
    });
  }
  return [...found.values()];
}

// --- Публикация -------------------------------------------------------------

export const telegramProvider: SocialProvider = {
  id: "TELEGRAM",

  // getAuthUrl и handleCallback не нужны: подключение идёт формой.

  async publish(account: DecryptedAccount, input: PublishInput): Promise<PublishResult> {
    const token = account.accessToken;
    const kind = String(account.meta?.kind ?? "channel");
    const set = input.settings ?? {};

    if (kind === "story") {
      const connectionId = String(account.meta?.businessConnectionId ?? "");
      if (!connectionId) {
        throw new PlatformError(
          "Telegram: нет связи с бизнес-аккаунтом — подключите историю заново",
          "reconnect"
        );
      }
      const hours = Number(set.storyHours ?? 86400);
      const activePeriod = STORY_PERIODS.has(hours) ? hours : 86400;

      // Содержимое истории уходит отдельным файлом, на него ссылается attach://
      const content = {
        type: "video",
        video: "attach://story_video",
        ...(input.durationSec ? { duration: Math.min(60, input.durationSec) } : {}),
        ...(input.coverMs !== null && input.coverMs !== undefined
          ? { cover_frame_timestamp: input.coverMs / 1000 }
          : {}),
      };
      await input.onStage?.("upload");
      const story = await upload<{ id: number }>(
        token,
        "postStory",
        {
          business_connection_id: connectionId,
          content: JSON.stringify(content),
          active_period: String(activePeriod),
          caption: truncateChars(input.caption ?? "", 2048),
          post_to_chat_page: String(set.keepOnPage !== false),
        },
        { field: "story_video", path: input.filePath, type: "video/mp4" }
      );
      return { externalId: String(story.id) };
    }

    // Канал: обычное видео с подписью.
    const chatId = String(account.meta?.chatId ?? account.providerAccountId);
    await input.onStage?.("upload");
    const msg = await upload<{ message_id: number; chat: { username?: string; id: number } }>(
      token,
      "sendVideo",
      {
        chat_id: chatId,
        caption: truncateChars(input.caption ?? "", CAPTION_LIMITS.TELEGRAM),
        supports_streaming: "true",
        disable_notification: String(set.silent === true),
      },
      { field: "video", path: input.filePath, type: "video/mp4" }
    );
    const url = msg.chat.username
      ? `https://t.me/${msg.chat.username}/${msg.message_id}`
      : undefined;
    return { externalId: String(msg.message_id), externalUrl: url };
  },
};
