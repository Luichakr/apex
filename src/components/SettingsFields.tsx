"use client";

import type { Provider } from "@prisma/client";
import {
  SETTINGS,
  fieldVisible,
  type SettingField,
  type SettingsValues,
} from "@/lib/publish-settings";

/**
 * Форма настроек публикации, собранная по описанию из publish-settings.ts.
 * Добавить площадке поле — значит дописать строку в таблицу, а не верстать
 * ещё одну форму.
 */
export default function SettingsFields({
  provider,
  values,
  onChange,
  disabled,
  /** Варианты, которые разрешила сама площадка (TikTok по аккаунту). */
  allowed,
  /** Поля, которые площадка примет только при прямой публикации. */
  inboxNote,
}: {
  provider: Provider;
  values: SettingsValues;
  onChange: (key: string, value: string | boolean) => void;
  disabled?: boolean;
  allowed?: Record<string, string[]>;
  inboxNote?: string;
}) {
  const groups = SETTINGS[provider].filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  const renderField = (f: SettingField) => {
    if (!fieldVisible(f, values)) return null;
    const id = `${provider}-${f.key}`;

    if (f.type === "toggle") {
      return (
        <div key={f.key} className="field">
          <label className="choice" style={{ minHeight: 56 }}>
            <input
              type="checkbox"
              id={id}
              checked={values[f.key] === true}
              disabled={disabled}
              onChange={(e) => onChange(f.key, e.target.checked)}
            />
            <span className="choice__box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span style={{ minWidth: 0 }}>
              <span>{f.label}</span>
              {f.hint && <span className="choice__sub" style={{ display: "block" }}>{f.hint}</span>}
            </span>
          </label>
        </div>
      );
    }

    // Площадка может разрешать не все варианты — недоступные показываем
    // выключенными с объяснением, а не прячем: иначе непонятно, куда делось.
    const allowedValues = f.optionsFrom && allowed?.[f.optionsFrom];
    return (
      <div key={f.key} className="field">
        <label className="field__label" htmlFor={id}>{f.label}</label>
        <select
          id={id}
          className="f"
          value={String(values[f.key] ?? f.default)}
          disabled={disabled}
          onChange={(e) => onChange(f.key, e.target.value)}
        >
          {(f.options ?? []).map((o) => {
            const blocked = Boolean(allowedValues && !allowedValues.includes(o.value));
            return (
              <option key={o.value} value={o.value} disabled={blocked}>
                {o.label}
                {blocked ? " — недоступно для этого аккаунта" : ""}
              </option>
            );
          })}
        </select>
        {f.hint && <span className="field__hint">{f.hint}</span>}
      </div>
    );
  };

  return (
    <div className="stack-sm">
      {inboxNote && <p className="meta">{inboxNote}</p>}
      {groups.map((g) => (
        <fieldset key={g.id} className="setgroup">
          <legend className="setgroup__title">{g.title}</legend>
          <div className="stack-sm">{g.fields.map(renderField)}</div>
        </fieldset>
      ))}
    </div>
  );
}
