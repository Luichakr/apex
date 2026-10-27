"use client";

import { useState } from "react";

export default function ShareToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    const r = await fetch("/api/support/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share: next }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) setOn(next);
  }

  return (
    <label className="choice" style={{ minHeight: 56 }}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
      <span className="choice__box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
      <span style={{ minWidth: 0 }}>
        <span>Друзья могут видеть мои публикации и поддерживать их</span>
        <span className="choice__sub" style={{ display: "block" }}>
          Только текст и ссылка опубликованных видео YouTube и LinkedIn. Выключить можно в любой момент.
        </span>
      </span>
    </label>
  );
}
