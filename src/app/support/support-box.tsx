"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: boolean; done?: string[]; reason?: string; reconnect?: boolean };

export default function SupportBox({
  targetId,
  liked,
  commented,
  canDraft,
}: {
  targetId: string;
  liked: boolean;
  commented: boolean;
  canDraft: boolean;
}) {
  const router = useRouter();
  const [like, setLike] = useState(!liked);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function suggest() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/support/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!j?.drafts?.length) setMsg({ kind: "error", text: "Не удалось подобрать варианты — напишите сами." });
    else setDrafts(j.drafts);
  }

  async function send() {
    const wantComment = !commented && text.trim().length > 0;
    const wantLike = !liked && like;
    if (!wantComment && !wantLike) {
      setMsg({ kind: "error", text: "Выберите лайк или напишите комментарий." });
      return;
    }
    const what = [wantLike && "лайк", wantComment && "комментарий"].filter(Boolean).join(" и ");
    if (!window.confirm(`Отправить ${what} от вашего аккаунта? Отменить это уже нельзя.`)) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/support/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, like: wantLike, comment: wantComment ? text : undefined }),
    }).catch(() => null);
    const j = (r ? await r.json().catch(() => null) : null) as Result | null;
    setBusy(false);
    if (j?.ok) {
      setMsg({ kind: "ok", text: `Готово: ${(j.done ?? []).join(", ")}.` });
      setText("");
      setDrafts([]);
      router.refresh();
    } else {
      setMsg({ kind: "error", text: j?.reason ?? "Не получилось — попробуйте позже." });
    }
  }

  return (
    <div className="stack-sm" style={{ marginTop: 10 }}>
      <label className="choice" style={{ minHeight: 44 }}>
        <input type="checkbox" checked={liked || like} disabled={liked || busy} onChange={(e) => setLike(e.target.checked)} />
        <span className="choice__box" aria-hidden />
        <span>{liked ? "Лайк уже стоит" : "Поставить лайк"}</span>
      </label>

      {commented ? (
        <p className="meta">Вы уже комментировали это видео.</p>
      ) : (
        <>
          <textarea
            className="f"
            rows={2}
            maxLength={300}
            placeholder="Тёплый комментарий по делу — своими словами"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
          {canDraft && (
            <button type="button" className="btn btn--tool btn--sm" disabled={busy} onClick={suggest}>
              Предложить варианты
            </button>
          )}
          {drafts.map((d) => (
            <button key={d} type="button" className="btn btn--tool btn--sm" style={{ textAlign: "left" }} onClick={() => setText(d)}>
              {d}
            </button>
          ))}
        </>
      )}

      <button type="button" className="btn btn--sm" disabled={busy} onClick={send}>
        Отправить
      </button>
      {msg && <p className={msg.kind === "ok" ? "meta" : "target__error"}>{msg.text}</p>}
    </div>
  );
}
