"use client";

import { useState } from "react";

export type Snippet = { id: string; title: string; text: string };

/**
 * Шаблоны текста: подпись, набор хештегов, призыв подписаться. Нажатие
 * добавляет фрагмент в конец текста — набирать одно и то же заново не нужно.
 */
export default function Snippets({
  initial,
  caption,
  disabled,
  onInsert,
}: {
  initial: Snippet[];
  caption: string;
  disabled: boolean;
  onInsert: (text: string) => void;
}) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const text = caption.trim();
    if (!text) return setError("Сначала напишите текст, который хотите сохранить.");
    const title = window.prompt("Название шаблона (например, «Хештеги про авто»)", text.split("\n")[0].slice(0, 40));
    if (!title?.trim()) return;
    setError("");
    const res = await fetch("/api/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim().slice(0, 40), text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Не удалось сохранить шаблон");
    setItems((s) => [data as Snippet, ...s]);
  }

  async function remove(s: Snippet) {
    if (!window.confirm(`Удалить шаблон «${s.title}»?`)) return;
    const res = await fetch(`/api/snippets/${s.id}`, { method: "DELETE" });
    if (res.ok) setItems((all) => all.filter((x) => x.id !== s.id));
  }

  return (
    <div className="stack-sm">
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {items.map((s) =>
          editing ? (
            <button key={s.id} type="button" className="btn btn--tool btn--sm" onClick={() => remove(s)} disabled={disabled}>
              × {s.title}
            </button>
          ) : (
            <button
              key={s.id}
              type="button"
              className="btn btn--tool btn--sm"
              title={s.text}
              disabled={disabled}
              onClick={() => onInsert(s.text)}
            >
              + {s.title}
            </button>
          )
        )}
        <button type="button" className="btn btn--tool btn--sm" onClick={save} disabled={disabled || editing}>
          Сохранить текст как шаблон
        </button>
        {items.length > 0 && (
          <button type="button" className="btn btn--tool btn--sm" onClick={() => setEditing((v) => !v)} disabled={disabled}>
            {editing ? "Готово" : "Удалить шаблоны"}
          </button>
        )}
      </div>
      {error && <p className="target__error">{error}</p>}
    </div>
  );
}
