"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

export default function LoginForm({ initialError }: { initialError: string | null }) {
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    initialError ? "error" : "idle"
  );
  const [message, setMessage] = useState(initialError ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, inviteCode: invite || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Не удалось отправить ссылку");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setMessage("Нет связи с сервером. Попробуйте ещё раз.");
    }
  }

  if (status === "sent") {
    return (
      <div className="msg msg--ok" role="status" style={{ marginTop: "var(--sp-md)" }}>
        <Icon name="check" />
        <div className="msg__body">
          <p>
            Ссылка отправлена на <b>{email}</b>. Откройте письмо и нажмите «Войти» —
            ссылка действует 15 минут.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack" style={{ marginTop: "var(--sp-md)" }} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="email">Email</label>
        <input
          id="email"
          className="f"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="invite">
          Инвайт-код <span className="opt">— только для первого входа</span>
        </label>
        <input
          id="invite"
          className="f"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          placeholder="Например, A1B2-C3D4"
        />
      </div>

      {status === "error" && message && (
        <div className="msg msg--error" role="alert">
          <Icon name="alert" />
          <div className="msg__body">{message}</div>
        </div>
      )}

      <button className="btn btn--stretch-sm" type="submit" disabled={status === "sending" || !email}>
        {status === "sending" ? <><span className="spinner" /> Отправляем…</> : "Прислать ссылку"}
      </button>
    </form>
  );
}
