"use client";

import type { Provider } from "@prisma/client";
import { BRAND_DOT, CHROME, outcomeFor, previewCaption, type MediaShape } from "@/lib/platforms";
import { PROVIDER_LABEL, measureFor } from "@/lib/limits";
import Icon from "./Icon";

/**
 * Как ролик будет выглядеть в сети: кадр 9:16 с её собственным интерфейсом
 * поверх. Для вертикального видео это главный вопрос — не перекроет ли подпись
 * и колонка кнопок то, что внизу кадра.
 *
 * Показываем только настоящую механику: ничего из нарисованного не нажимается,
 * цифры под кнопками — условные, о чём сказано подписью под превью.
 */
export default function NetworkPreview({
  provider,
  videoUrl,
  caption,
  shape,
  accountName,
}: {
  provider: Provider;
  videoUrl: string | null;
  caption: string;
  shape: MediaShape | null;
  accountName?: string | null;
}) {
  const chrome = CHROME[provider];
  const outcome = outcomeFor(provider, shape);
  const { title, body } = previewCaption(provider, caption);
  const measure = measureFor(provider, provider === "YOUTUBE" ? caption : body || caption);
  const over = measure.used > measure.limit;
  const handle = accountName?.replace(/^@/, "") || "ваш аккаунт";

  return (
    <figure className="np">
      <figcaption className="np__head">
        <span className="np__name">
          <span className="np__dot" style={{ background: BRAND_DOT[provider] }} aria-hidden />
          {PROVIDER_LABEL[provider]}
        </span>
        <span className={`tag ${outcome.tone === "ok" ? "tag--ok" : outcome.tone === "warn" ? "tag--warn" : "tag--error"}`}>
          {outcome.format}
        </span>
      </figcaption>

      <div className="np__frame">
        {videoUrl ? (
          <video className="np__video" src={videoUrl} muted playsInline preload="metadata" />
        ) : (
          <div className="np__video np__video--empty">
            <Icon name="film" />
          </div>
        )}

        {/* Затемнение снизу — у всех трёх сетей кадр под подписью притемнён. */}
        <div className="np__scrim" style={{ height: `${(chrome.bottom + 0.14) * 100}%` }} aria-hidden />

        {/* Колонка кнопок справа: показывает, какую часть кадра она закрывает. */}
        <div className="np__rail" style={{ width: `${chrome.right * 100}%` }} aria-hidden>
          <span className="np__btn" />
          <span className="np__btn" />
          <span className="np__btn" />
        </div>

        {provider === "YOUTUBE" && (
          <div className="np__bottom" style={{ paddingRight: `${chrome.right * 100}%` }}>
            <p className="np__title" title={title}>
              {title || <span className="np__ph">Первая строка станет заголовком</span>}
            </p>
            <p className="np__handle">@{handle}</p>
          </div>
        )}

        {provider !== "YOUTUBE" && (
          <div className="np__bottom" style={{ paddingRight: `${chrome.right * 100}%` }}>
            <p className="np__handle">@{handle}</p>
            <p className="np__caption" style={{ WebkitLineClamp: chrome.captionLines }}>
              {body || <span className="np__ph">Текст публикации</span>}
            </p>
            {provider === "TIKTOK" && <p className="np__music">♪ оригинальный звук</p>}
          </div>
        )}

        {/* Граница безопасной зоны: ниже неё кадр перекрыт интерфейсом сети. */}
        <div className="np__safe" style={{ bottom: `${chrome.bottom * 100}%` }} aria-hidden>
          <span>ниже перекроет интерфейс</span>
        </div>
      </div>

      <div className="np__foot">
        {outcome.note && (
          <p className={`np__note ${outcome.tone === "error" ? "np__note--error" : ""}`}>{outcome.note}</p>
        )}
        <p className={`np__count ${over ? "over" : ""}`}>
          {provider === "TIKTOK"
            ? "Текст вставите в приложении"
            : `Осталось ${measure.limit - measure.used} ${measure.unit}`}
        </p>
      </div>
    </figure>
  );
}
