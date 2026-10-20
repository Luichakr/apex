/**
 * POST /api/connect/telegram — подключить канал или истории Telegram.
 *
 * У Telegram нет OAuth: владелец заводит бота у @BotFather и вставляет его
 * токен. Поэтому подключение — обычная форма, а не переход на сайт площадки.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { saveAccount } from "@/lib/accounts";
import { rateLimit } from "@/lib/rate-limit";
import {
  checkBotToken,
  checkChannel,
  findBusinessConnections,
} from "@/lib/providers/telegram";

const schema = z.object({
  token: z.string().trim().min(20).max(200),
  kind: z.enum(["channel", "story"]),
  chatId: z.string().trim().max(120).optional(),
  businessConnectionId: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  const env = getEnv();
  const user = await getCurrentUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/accounts?${q}`, env.APP_URL), 303);
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL), 303);
  if (user.role === "VIEWER") return back("error=" + encodeURIComponent("Ваша роль — наблюдатель: подключение недоступно"));

  // Токен проверяется обращением к Telegram — не даём перебирать.
  if (!(await rateLimit(`tg-connect:${user.id}`, 20, 10 * 60))) {
    return back("error=" + encodeURIComponent("Слишком много попыток, подождите немного"));
  }

  const form = await req.formData().catch(() => null);
  const parsed = schema.safeParse({
    token: form?.get("token") ?? "",
    kind: form?.get("kind") ?? "channel",
    chatId: form?.get("chatId") ?? undefined,
    businessConnectionId: form?.get("businessConnectionId") ?? undefined,
  });
  if (!parsed.success) {
    return back("error=" + encodeURIComponent("Проверьте токен бота и адрес канала"));
  }
  const { token, kind, chatId, businessConnectionId } = parsed.data;

  try {
    const bot = await checkBotToken(token);
    const botName = bot.username ? `@${bot.username}` : (bot.first_name ?? "бот");

    if (kind === "channel") {
      if (!chatId) return back("error=" + encodeURIComponent("Укажите адрес канала"));
      const chat = await checkChannel(token, chatId);
      await saveAccount(user.id, "TELEGRAM", {
        providerAccountId: `channel:${chat.id}`,
        displayName: `${chat.title} (через ${botName})`,
        accessToken: token,
        meta: { kind: "channel", chatId: chat.id, botName },
      });
      return back("connected=telegram");
    }

    // Истории: бот должен быть подключён к бизнес-аккаунту с правом на истории.
    // Два очень похожих симптома с разными причинами: либо боту не включён
    // режим работы от имени пользователя, либо его просто не добавили в
    // «Чат-боты». Телеграм отвечает на это прямо — не заставляем гадать.
    if (bot.can_connect_to_business === false) {
      return back(
        "error=" +
          encodeURIComponent(
            `Боту ${botName} не включён режим работы от имени пользователя. В @BotFather: /mybots → ${botName} → Bot Settings → Mode Settings → включите «Secretary Mode». Затем добавьте бота в Настройки → Telegram для бизнеса → Чат-боты.`
          )
      );
    }

    const connections = await findBusinessConnections(token);
    const chosen = businessConnectionId
      ? connections.find((c) => c.id === businessConnectionId)
      : connections[0];
    if (!chosen) {
      return back(
        "error=" +
          encodeURIComponent(
            `Режим у бота включён, но он ещё не добавлен к вашему аккаунту. На телефоне: Telegram → Настройки → Telegram для бизнеса → Чат-боты → впишите ${botName} → включите «Управление историями». Затем повторите здесь.`
          )
      );
    }
    if (!chosen.canManageStories) {
      return back(
        "error=" +
          encodeURIComponent(
            "Боту не выдано право «Управление историями» — включите его в настройках Telegram и повторите."
          )
      );
    }
    await saveAccount(user.id, "TELEGRAM", {
      providerAccountId: `story:${chosen.id}`,
      displayName: `Истории ${chosen.title}`,
      accessToken: token,
      meta: { kind: "story", businessConnectionId: chosen.id, botName },
    });
    return back("connected=telegram");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Не удалось подключить Telegram";
    return back("error=" + encodeURIComponent(message));
  }
}
