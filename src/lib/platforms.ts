/**
 * Что каждая сеть сделает с нашим видео и как она его покажет.
 *
 * Одна таблица на три задачи: предварительная сводка «что куда уйдёт»,
 * живые превью с настоящими рамками сетей и подсказки в композере.
 * Можно импортировать и на клиенте, и на сервере — здесь только расчёты.
 */
import type { Provider } from "@prisma/client";

/** Что получится из видео в этой сети. */
export type Outcome = {
  /** Короткое имя формата: «Shorts», «Reels», «Видео». */
  format: string;
  tone: "ok" | "warn" | "error";
  /** Почему не идеально (если не идеально). */
  note?: string;
};

export type MediaShape = {
  width: number;
  height: number;
  durationSec: number;
};

/** Предельная длительность, после которой формат перестаёт быть коротким. */
const SHORTS_MAX_SEC = 180;

/**
 * Во что превратится ролик в конкретной сети. Считается и в браузере (по
 * данным тега video, ещё до загрузки), и на сервере — поэтому на вход идут
 * только размеры и длительность.
 */
export function outcomeFor(
  provider: Provider,
  m: MediaShape | null,
  variant?: string | null
): Outcome {
  if (!m || !m.width || !m.height) {
    return { format: variant === "story" ? "История" : FORMAT_NAME[provider], tone: "ok" };
  }
  const vertical = m.height >= m.width;

  if (provider === "YOUTUBE") {
    if (m.durationSec > SHORTS_MAX_SEC) {
      return {
        format: "Обычное видео",
        tone: "warn",
        note: "длиннее 3 минут — в Shorts не попадёт",
      };
    }
    if (!vertical) {
      return {
        format: "Обычное видео",
        tone: "warn",
        note: "горизонтальное — в Shorts не попадёт",
      };
    }
    return { format: "Shorts", tone: "ok" };
  }

  if (provider === "INSTAGRAM") {
    if (m.durationSec < 3) {
      return { format: "Reels", tone: "error", note: "короче 3 секунд — Instagram не примет" };
    }
    if (m.durationSec > 15 * 60) {
      return { format: "Reels", tone: "error", note: "длиннее 15 минут — Instagram не примет" };
    }
    if (!vertical) {
      return { format: "Reels", tone: "warn", note: "горизонтальное — в ленте обрежется по краям" };
    }
    return { format: "Reels", tone: "ok" };
  }

  if (provider === "TIKTOK") {
    if (m.durationSec > 10 * 60) {
      return { format: "Видео", tone: "error", note: "длиннее 10 минут — TikTok не примет" };
    }
    if (Math.min(m.width, m.height) < 360) {
      return { format: "Видео", tone: "error", note: "меньше 360 px — TikTok не примет" };
    }
    return { format: "Видео", tone: "ok", note: "придёт во входящие приложения" };
  }

  if (provider === "TELEGRAM") {
    // Истории Telegram — ровно до минуты; у канала такого ограничения нет.
    if (variant === "story") {
      if (m.durationSec > 60) {
        return { format: "История", tone: "error", note: "истории Telegram — не длиннее 60 секунд" };
      }
      return { format: "История", tone: "ok", note: "будет приведено к 720×1280" };
    }
    return { format: "Видео в канале", tone: "ok" };
  }

  return { format: "Публикация на Странице", tone: "ok" };
}

const FORMAT_NAME: Record<Provider, string> = {
  YOUTUBE: "Shorts",
  INSTAGRAM: "Reels",
  TIKTOK: "Видео",
  FACEBOOK: "Публикация",
  TELEGRAM: "Видео",
};

/**
 * Как сеть показывает видео: чем закрыт кадр её собственным интерфейсом.
 * Нужно, чтобы в превью было видно, что именно перекроет подпись и кнопки.
 */
export type Chrome = {
  /** Доля высоты кадра, занятая нижней панелью (подпись, музыка, кнопки). */
  bottom: number;
  /** Доля ширины, занятая колонкой кнопок справа. */
  right: number;
  /** Доля высоты, занятая верхней панелью. */
  top: number;
  /** Сколько строк подписи видно без нажатия «ещё». */
  captionLines: number;
  /** Подпись показывается поверх видео (а не под ним). */
  overlay: boolean;
};

export const CHROME: Record<Provider, Chrome> = {
  // Reels: подпись и кнопки лежат поверх кадра внизу, колонка действий справа.
  INSTAGRAM: { bottom: 0.2, right: 0.16, top: 0.08, captionLines: 2, overlay: true },
  // TikTok закрывает низ сильнее: имя, подпись, строка музыки.
  TIKTOK: { bottom: 0.24, right: 0.17, top: 0.07, captionLines: 2, overlay: true },
  // В Shorts заголовок и кнопки тоже поверх кадра.
  YOUTUBE: { bottom: 0.17, right: 0.15, top: 0.07, captionLines: 2, overlay: true },
  FACEBOOK: { bottom: 0, right: 0, top: 0, captionLines: 3, overlay: false },
  // В Telegram подпись идёт под видео, кадр ничем не перекрыт.
  TELEGRAM: { bottom: 0, right: 0, top: 0, captionLines: 3, overlay: false },
};

/** Фирменный цвет сети — только для точки-метки в превью, не для заливок. */
export const BRAND_DOT: Record<Provider, string> = {
  YOUTUBE: "#ff0033",
  INSTAGRAM: "#e1306c",
  TIKTOK: "#00f2ea",
  FACEBOOK: "#0866ff",
  TELEGRAM: "#2aabee",
};

/** Первая строка текста — заголовок для YouTube, для остальных подпись целиком. */
export function previewCaption(provider: Provider, text: string): { title?: string; body: string } {
  if (provider === "YOUTUBE") {
    const lines = text.split("\n");
    const titleIndex = lines.findIndex((l) => l.trim().length > 0);
    if (titleIndex === -1) return { title: "", body: "" };
    return {
      title: lines[titleIndex].trim(),
      body: lines.slice(titleIndex + 1).join("\n").trim(),
    };
  }
  return { body: text };
}
