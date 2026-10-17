"use client";

import { useState } from "react";
import Icon from "./Icon";

/**
 * Подключение Telegram. В отличие от остальных сетей здесь нет перехода на
 * сайт площадки: владелец заводит бота у @BotFather и вставляет его токен.
 */
export default function TelegramConnect() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"channel" | "story">("channel");

  if (!open) {
    return (
      <button type="button" className="btn btn--block" onClick={() => setOpen(true)}>
        Подключить Telegram
      </button>
    );
  }

  return (
    <form action="/api/connect/telegram" method="post" className="stack-sm">
      <input type="hidden" name="kind" value={kind} />

      <div className="row" role="radiogroup" aria-label="Что подключаем">
        {([
          ["channel", "Канал"],
          ["story", "Истории"],
        ] as const).map(([value, label]) => (
          <label key={value} className="choice" style={{ minHeight: 44, flex: "0 1 auto" }}>
            <input
              type="radio"
              name="kindChoice"
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            <span className="choice__box"><Icon name="check" /></span>
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="tg-token">Токен бота</label>
        <input
          id="tg-token"
          className="f"
          name="token"
          type="password"
          required
          autoComplete="off"
          placeholder="1234567890:AA..."
        />
        <span className="field__hint">
          Напишите <b>@BotFather</b> в Telegram, команда <code>/newbot</code> — он выдаст токен.
        </span>
      </div>

      {kind === "channel" ? (
        <div className="field">
          <label className="field__label" htmlFor="tg-chat">Канал</label>
          <input id="tg-chat" className="f" name="chatId" required placeholder="@my_channel" />
          <span className="field__hint">
            Добавьте бота в канал администратором с правом публикации, иначе Telegram откажет.
          </span>
        </div>
      ) : (
        <div className="msg">
          <Icon name="info" />
          <div className="msg__body">
            <p>Для историй нужно разрешить боту ими управлять:</p>
            <p className="meta">
              Telegram → Настройки → <b>Telegram для бизнеса</b> → <b>Чат-боты</b> → добавьте
              своего бота и включите <b>«Управление историями»</b>. Затем нажмите «Подключить».
            </p>
            <p className="meta">
              Раздел «Для бизнеса» доступен только с подпиской <b>Telegram Premium</b> — это
              требование самого Telegram, обойти его нельзя.
            </p>
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn" type="submit">Подключить</button>
        <button type="button" className="btn btn--tool" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
