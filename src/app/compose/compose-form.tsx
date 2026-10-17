"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@prisma/client";
import Icon from "@/components/Icon";
import NetworkPreview from "@/components/NetworkPreview";
import CoverPicker from "@/components/CoverPicker";
import SettingsFields from "@/components/SettingsFields";
import { defaultSettings, hasSettings, type SettingsValues } from "@/lib/publish-settings";
import { outcomeFor } from "@/lib/platforms";
import {
  CAPTION_NOT_SENT,
  PROVIDER_LABEL,
  YOUTUBE_TITLE_LIMIT,
  captionIssues,
  charCount,
  measureFor,
  youtubeTitleFrom,
} from "@/lib/limits";

type Account = {
  id: string;
  provider: string;
  displayName: string | null;
  /** У Telegram важно, канал это или истории: правила разные. */
  meta?: unknown;
};

/** "channel" | "story" у Telegram, иначе ничего. */
function variantOf(a: Account | undefined): string | null {
  const m = a?.meta as { kind?: unknown } | null | undefined;
  return typeof m?.kind === "string" ? m.kind : null;
}
type VideoMeta = { width: number; height: number; duration: number };

const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const FORMAT_LABEL: Record<string, string> = {
  YOUTUBE: "Shorts",
  INSTAGRAM: "Reels",
  TIKTOK: "во входящие",
  FACEBOOK: "Страница",
};

function fmtBytes(n: number) {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} ГБ` : `${Math.max(1, Math.round(n / 1024 ** 2))} МБ`;
}
function fmtDur(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
function localNow() {
  const d = new Date(Date.now() + 2 * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function ComposeForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [over, setOver] = useState(false);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<string[]>(accounts.map((a) => a.id));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [coverMs, setCoverMs] = useState<number | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<Record<string, SettingsValues>>({});
  const [when, setWhen] = useState<"now" | "in" | "at">("now");
  const [inHours, setInHours] = useState(1);
  const [scheduledAt, setScheduledAt] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState({ loaded: 0, total: 0, speed: 0 });
  const [error, setError] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (phase === "idle") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    setError("");
    setMeta(null);
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setCoverMs(null);
    setCoverFile(null);
    setUrl(URL.createObjectURL(f));
  }

  const providers = useMemo(() => {
    const set = new Set<Provider>();
    for (const id of selected) {
      const a = accounts.find((x) => x.id === id);
      if (a) set.add(a.provider as Provider);
    }
    return Array.from(set);
  }, [selected, accounts]);

  /** Выбранные назначения: по одному на аккаунт — Telegram бывает дважды. */
  const destinations = useMemo(
    () =>
      selected
        .map((id) => accounts.find((a) => a.id === id))
        .filter((a): a is Account => Boolean(a))
        .map((a) => ({
          account: a,
          provider: a.provider as Provider,
          variant: variantOf(a),
        })),
    [selected, accounts]
  );

  const effective = (p: Provider) => (overrides[p]?.trim() ? overrides[p].trim() : caption);

  // Проверки текста по сетям.
  const textIssues = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const p of providers) {
      const r = captionIssues(p, effective(p));
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
    return { errors, warnings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, caption, overrides]);

  // Проверки видео по сетям (по данным браузера; кодек и HDR сервер определит сам).
  const videoIssues = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (file && file.size > MAX_BYTES) errors.push("Файл больше 4 ГБ");
    if (!meta) return { errors, warnings };
    const vertical = meta.height >= meta.width;
    if (providers.includes("YOUTUBE")) {
      if (meta.duration > 180) warnings.push("YouTube: длиннее 3 минут — выйдет обычным видео, не Shorts");
      else if (!vertical) warnings.push("YouTube: горизонтальное — выйдет обычным видео, не Shorts");
    }
    if (providers.includes("INSTAGRAM")) {
      if (meta.duration < 3) errors.push("Instagram: видео короче 3 секунд");
      if (meta.duration > 900) errors.push("Instagram: видео длиннее 15 минут");
    }
    if (providers.includes("TIKTOK") && meta.duration > 600) errors.push("TikTok: видео длиннее 10 минут");
    if (destinations.some((d) => d.variant === "story") && meta.duration > 60) {
      errors.push("Telegram: история не может быть длиннее 60 секунд");
    }
    return { errors, warnings };
  }, [file, meta, providers, destinations]);

  const blocking = [...videoIssues.errors, ...textIssues.errors];
  const busy = phase !== "idle";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!file) return setError("Прикрепите видео");
    if (selected.length === 0) return setError("Выберите хотя бы одну сеть");
    if (blocking.length) return setError("Исправьте перед публикацией:\n• " + blocking.join("\n• "));

    const fd = new FormData();
    // Поля идут до файла — сервер читает форму потоком.
    fd.append("caption", caption);
    const publishAt =
      when === "in"
        ? new Date(Date.now() + inHours * 3600_000)
        : when === "at" && scheduledAt
          ? new Date(scheduledAt)
          : null;
    if (publishAt) fd.append("scheduledAt", publishAt.toISOString());
    if (coverMs !== null) fd.append("coverMs", String(Math.round(coverMs)));
    const sets: Record<string, SettingsValues> = {};
    for (const p of providers) {
      if (hasSettings(p)) sets[p] = { ...defaultSettings(p), ...(settings[p] ?? {}) };
    }
    if (Object.keys(sets).length) fd.append("settings", JSON.stringify(sets));
    selected.forEach((id) => fd.append("accountIds", id));
    const ov: Record<string, string> = {};
    for (const p of providers) if (overrides[p]?.trim()) ov[p] = overrides[p].trim();
    if (Object.keys(ov).length) fd.append("overrides", JSON.stringify(ov));
    if (coverFile) fd.append("cover", coverFile, coverFile.name);
    fd.append("video", file, file.name);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    const started = Date.now();
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const secs = Math.max(0.5, (Date.now() - started) / 1000);
      setProgress({ loaded: ev.loaded, total: ev.total, speed: ev.loaded / secs });
      if (ev.loaded >= ev.total) setPhase("saving");
    };
    xhr.onload = () => {
      xhrRef.current = null;
      let data: { ok?: boolean; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        setPhase("idle");
        router.push("/posts?created=1");
        router.refresh();
        return;
      }
      setPhase("idle");
      setError(
        data.error ??
          (xhr.status === 413 ? "Файл слишком большой для сервера" : `Не удалось загрузить (код ${xhr.status})`)
      );
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase("idle");
      setError("Связь прервалась во время загрузки. Попробуйте ещё раз.");
    };
    xhr.onabort = () => { xhrRef.current = null; setPhase("idle"); };
    xhr.open("POST", "/api/posts");
    setPhase("uploading");
    setProgress({ loaded: 0, total: file.size, speed: 0 });
    xhr.send(fd);
  }

  const shape = meta ? { width: meta.width, height: meta.height, durationSec: meta.duration } : null;
  const pct = progress.total ? Math.floor((progress.loaded / progress.total) * 100) : 0;
  const eta = progress.speed ? Math.max(0, (progress.total - progress.loaded) / progress.speed) : 0;
  const ytTitle = youtubeTitleFrom(effective("YOUTUBE"));

  return (
    <form className="compose" onSubmit={submit} noValidate>
      {/* ── Видео ── */}
      <div className="compose__media stack-sm">
        {!file ? (
          <label
            className="drop"
            data-over={over}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
          >
            <input
              type="file"
              accept="video/*,.mov,.mp4,.m4v,.webm,.mkv"
              onChange={(e) => pick(e.target.files?.[0])}
              aria-label="Выбрать видео"
            />
            <Icon name="upload" />
            <span style={{ fontSize: "var(--fs-md)" }}>Перетащите видео или нажмите, чтобы выбрать</span>
            <span className="meta">MOV, MP4, WebM, MKV · до 4 ГБ · 4K, HDR и 60 fps — без проблем</span>
          </label>
        ) : (
          <>
            <div className="preview">
              <video
                src={url ?? undefined}
                controls
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
                }}
              />
            </div>
            <div className="between">
              <div style={{ minWidth: 0 }}>
                <p style={{ overflowWrap: "anywhere" }}>{file.name}</p>
                <p className="meta">
                  {fmtBytes(file.size)}
                  {meta && meta.width ? ` · ${meta.width}×${meta.height} · ${fmtDur(meta.duration)}` : ""}
                </p>
              </div>
              <label className="btn btn--tool btn--sm" style={{ position: "relative", overflow: "hidden" }}>
                Заменить
                <input
                  type="file"
                  accept="video/*,.mov,.mp4,.m4v,.webm,.mkv"
                  disabled={busy}
                  onChange={(e) => pick(e.target.files?.[0])}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                />
              </label>
            </div>
            <p className="meta">
              Оригинал не изменяется. Кодек, частоту кадров и HDR сервер определит сам и подготовит
              отдельную версию под каждую сеть.
            </p>
          </>
        )}
        {[...videoIssues.errors.map((t) => ({ t, k: "error" })), ...videoIssues.warnings.map((t) => ({ t, k: "warn" }))].map(({ t, k }) => (
          <div key={t} className={`msg msg--${k}`}>
            <Icon name="alert" />
            <div className="msg__body">{t}</div>
          </div>
        ))}

        {file && url && meta && meta.duration > 0 && (
          <CoverPicker
            videoUrl={url}
            durationSec={meta.duration}
            valueMs={coverMs}
            onChange={setCoverMs}
            coverFile={coverFile}
            onCoverFile={setCoverFile}
            disabled={busy}
          />
        )}

        {providers.length > 0 && (
          <section aria-labelledby="preview-h" style={{ marginTop: "var(--sp-sm)" }}>
            <h2 id="preview-h" style={{ fontSize: "var(--fs-md)", marginBottom: 10 }}>
              Как это будет выглядеть.
            </h2>
            <div className="previews">
              {destinations.map((d) => (
                <NetworkPreview
                  key={d.account.id}
                  provider={d.provider}
                  variant={d.variant}
                  videoUrl={url}
                  caption={effective(d.provider)}
                  shape={shape}
                  accountName={d.account.displayName}
                />
              ))}
            </div>
            <p className="previews__disclaimer">
              Рамка показывает, что перекроет интерфейс сети. Точная подача у площадок
              меняется — превью помогает оценить кадр, а не гарантирует результат.
            </p>
          </section>
        )}
      </div>

      {/* ── Текст и сети ── */}
      <div className="stack">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>Куда публиковать</legend>
          <div className="choice-grid">
            {accounts.map((a) => (
              <label key={a.id} className="choice">
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  disabled={busy}
                  onChange={() =>
                    setSelected((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))
                  }
                />
                <span className="choice__box"><Icon name="check" /></span>
                <span style={{ minWidth: 0 }}>
                  <span className="choice__title">{PROVIDER_LABEL[a.provider as Provider] ?? a.provider}</span>
                  <span className="choice__sub" style={{ display: "block", overflowWrap: "anywhere" }}>
                    {FORMAT_LABEL[a.provider] ?? ""}{a.displayName ? ` · ${a.displayName}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor="caption">Текст публикации</label>
          <textarea
            id="caption"
            className="f"
            value={caption}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
            rows={6}
            placeholder={"Первая строка — заголовок для YouTube\n\nОписание и #хештеги"}
            aria-invalid={textIssues.errors.length > 0}
          />
          {providers.length > 0 && (
            <div className="counter" aria-live="polite">
              {providers.map((p) => {
                if (CAPTION_NOT_SENT.includes(p)) {
                  return <span key={p}>{PROVIDER_LABEL[p]}: текст вставите в приложении</span>;
                }
                const m = measureFor(p, effective(p));
                const left = m.limit - m.used;
                // Остаток понятнее израсходованного: видно, сколько ещё можно.
                const tight = left < m.limit * 0.2;
                return (
                  <span key={p} className={left < 0 ? "over" : tight ? "tight" : undefined}>
                    {PROVIDER_LABEL[p]}: осталось {left} {m.unit}
                  </span>
                );
              })}
              {providers.includes("YOUTUBE") && (
                <span className={charCount(ytTitle) > YOUTUBE_TITLE_LIMIT ? "over" : undefined}>
                  Заголовок YouTube: осталось {YOUTUBE_TITLE_LIMIT - charCount(ytTitle)}
                </span>
              )}
            </div>
          )}
        </div>

        {providers.length > 1 && (
          <details className="panel" style={{ padding: "4px var(--sp-md)" }}>
            <summary style={{ cursor: "pointer", minHeight: 52, display: "flex", alignItems: "center" }}>
              Разный текст для разных сетей
            </summary>
            <div className="stack-sm" style={{ paddingBottom: "var(--sp-md)" }}>
              <p className="meta">Пустое поле — используется общий текст.</p>
              {providers.map((p) => {
                const m = measureFor(p, effective(p));
                return (
                  <div className="field" key={p}>
                    <label className="field__label" htmlFor={`ov-${p}`}>{PROVIDER_LABEL[p]}</label>
                    <textarea
                      id={`ov-${p}`}
                      className="f"
                      rows={3}
                      disabled={busy}
                      value={overrides[p] ?? ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [p]: e.target.value }))}
                      placeholder={`Отдельный текст для ${PROVIDER_LABEL[p]}`}
                      style={{ minHeight: 96 }}
                    />
                    {!CAPTION_NOT_SENT.includes(p) && (
                      <span className={`counter ${m.used > m.limit ? "over" : ""}`}>
                        осталось {m.limit - m.used} {m.unit}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {providers.filter(hasSettings).map((p) => (
          <details className="panel" key={`set-${p}`} style={{ padding: "4px var(--sp-md)" }}>
            <summary style={{ cursor: "pointer", minHeight: 52, display: "flex", alignItems: "center" }}>
              Настроить для {PROVIDER_LABEL[p]}
            </summary>
            <div style={{ paddingBottom: "var(--sp-md)" }}>
              <SettingsFields
                provider={p}
                values={{ ...defaultSettings(p), ...(settings[p] ?? {}) }}
                disabled={busy}
                inboxNote={
                  p === "TIKTOK"
                    ? "TikTok принимает эти настройки только при прямой публикации. Сейчас видео приходит во входящие приложения, и там вы выставите их сами — здесь они сохранятся на будущее."
                    : undefined
                }
                onChange={(key, value) =>
                  setSettings((prev) => ({
                    ...prev,
                    [p]: { ...defaultSettings(p), ...(prev[p] ?? {}), [key]: value },
                  }))
                }
              />
            </div>
          </details>
        ))}

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>Когда опубликовать</legend>
          <div className="row" role="radiogroup" aria-label="Когда опубликовать">
            {([
              ["now", "Сразу"],
              ["in", "Через…"],
              ["at", "В выбранное время"],
            ] as const).map(([value, label]) => (
              <label key={value} className="choice" style={{ minHeight: 48, flex: "0 1 auto" }}>
                <input
                  type="radio"
                  name="when"
                  checked={when === value}
                  disabled={busy}
                  onChange={() => setWhen(value)}
                />
                <span className="choice__box"><Icon name="check" /></span>
                <span>{label}</span>
              </label>
            ))}
          </div>

          {when === "in" && (
            <div className="row" style={{ marginTop: 12 }}>
              {[1, 2, 3, 6, 12, 24].map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`btn btn--tool btn--sm ${inHours === h ? "is-on" : ""}`}
                  aria-pressed={inHours === h}
                  disabled={busy}
                  onClick={() => setInHours(h)}
                >
                  {h} ч
                </button>
              ))}
              <span className="meta">
                выйдет {new Date(Date.now() + inHours * 3600_000).toLocaleString("ru-RU", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}

          {when === "at" && (
            <div className="field" style={{ marginTop: 12 }}>
              <input
                className="f"
                type="datetime-local"
                min={localNow()}
                disabled={busy}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{ maxWidth: 360 }}
                aria-label="Дата и время публикации"
              />
              <span className="field__hint">
                Время вашего устройства ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
              </span>
            </div>
          )}
        </fieldset>

        {[...textIssues.errors.map((t) => ({ t, k: "error" })), ...textIssues.warnings.map((t) => ({ t, k: "warn" }))].map(({ t, k }) => (
          <div key={t} className={`msg msg--${k}`}>
            <Icon name="alert" />
            <div className="msg__body">{t}</div>
          </div>
        ))}
        {error && (
          <div className="msg msg--error" role="alert">
            <Icon name="alert" />
            <div className="msg__body">{error}</div>
          </div>
        )}

        {providers.length > 0 && (
          <section className="panel" aria-labelledby="review-h">
            <h2 id="review-h" style={{ fontSize: "var(--fs-md)", marginBottom: 4 }}>
              Что куда уйдёт.
            </h2>
            <div className="review">
              {destinations.map((d) => {
                const o = outcomeFor(d.provider, shape, d.variant);
                return (
                  <div className="review__row" key={d.account.id}>
                    <span className="review__net">{PROVIDER_LABEL[d.provider]}</span>
                    <span className="review__what">{o.format}</span>
                    {o.note && (
                      <span className={`review__why ${o.tone === "error" ? "review__why--error" : ""}`}>
                        {o.note}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {busy ? (
          <div className="panel stack-sm" aria-live="polite">
            <div className="between">
              <span>{phase === "saving" ? "Сохраняем видео на сервере…" : `Загружаем видео · ${pct}%`}</span>
              {phase === "uploading" && (
                <button type="button" className="link-btn small" onClick={() => xhrRef.current?.abort()}>
                  Отменить
                </button>
              )}
            </div>
            <div className={`bar ${phase === "saving" ? "bar--indet" : ""}`}>
              <div className="bar__fill" style={phase === "uploading" ? { width: `${pct}%` } : undefined} />
            </div>
            {phase === "uploading" && progress.speed > 0 && (
              <p className="meta">
                {fmtBytes(progress.loaded)} из {fmtBytes(progress.total)} · {(progress.speed / 1024 ** 2).toFixed(1)} МБ/с
                {eta > 1 ? ` · осталось ~${eta > 90 ? `${Math.round(eta / 60)} мин` : `${Math.round(eta)} с`}` : ""}
              </p>
            )}
            <p className="meta">Не закрывайте страницу до конца загрузки.</p>
          </div>
        ) : (
          <div className="submitbar">
            <button className="btn btn--stretch-sm" type="submit" disabled={!file || selected.length === 0 || blocking.length > 0}>
              {when === "now"
                ? `Опубликовать${providers.length ? ` в ${providers.length}` : ""}`
                : <><Icon name="clock" /> Запланировать</>}
            </button>
            {providers.length > 0 && (
              <span className="meta">
                {providers.map((p) => PROVIDER_LABEL[p]).join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
