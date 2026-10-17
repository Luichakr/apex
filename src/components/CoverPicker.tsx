"use client";

import { useEffect, useRef, useState } from "react";
import { candidateTimestamps, captureFrame, clampCoverMs, formatTimecode } from "@/lib/cover";
import Icon from "./Icon";

type Candidate = { ms: number; url: string };

/**
 * Выбор кадра-обложки: пять автоматических кандидатов плюс ползунок по всей
 * длительности. Кадры снимаются скрытой копией видео, чтобы перемотка не
 * дёргала то, что пользователь смотрит в превью.
 */
export default function CoverPicker({
  videoUrl,
  durationSec,
  valueMs,
  onChange,
  coverFile,
  onCoverFile,
  disabled,
}: {
  videoUrl: string;
  durationSec: number;
  valueMs: number | null;
  onChange: (ms: number | null) => void;
  coverFile: File | null;
  onCoverFile: (f: File | null) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const durationMs = Math.round(durationSec * 1000);
  // Пока кадр не выбран, сеть покажет свой — у нас это 10% длительности.
  const effectiveMs = valueMs ?? clampCoverMs(durationMs * 0.1, durationMs);

  // Показ загруженной картинки.
  useEffect(() => {
    if (!coverFile) {
      setUploadUrl(null);
      return;
    }
    const u = URL.createObjectURL(coverFile);
    setUploadUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [coverFile]);

  // Кандидаты пересобираются при смене файла; старые ссылки освобождаем.
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setCandidates([]);
    const video = videoRef.current;
    if (!video || !durationMs) return;

    (async () => {
      for (const ms of candidateTimestamps(durationMs)) {
        try {
          const blob = await captureFrame(video, ms, 240);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          made.push(url);
          setCandidates((c) => [...c, { ms, url }]);
        } catch {
          /* кадр не снялся — пропускаем, остальные всё равно полезны */
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [videoUrl, durationMs]);

  // Крупный предпросмотр выбранного кадра.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const video = videoRef.current;
    if (!video || !durationMs) return;
    setBusy(true);
    const t = setTimeout(() => {
      captureFrame(video, effectiveMs, 360)
        .then((blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setCurrent(url);
        })
        .catch(() => {})
        .finally(() => !cancelled && setBusy(false));
    }, 180); // ползунок тянут непрерывно — снимаем кадр после паузы
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [effectiveMs, videoUrl, durationMs]);

  return (
    <section className="cover" aria-labelledby="cover-h">
      <div className="between">
        <h3 id="cover-h" style={{ fontSize: "var(--fs-md)" }}>Обложка.</h3>
        {(valueMs !== null || coverFile) && (
          <button
            type="button"
            className="link-btn small"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              onCoverFile(null);
            }}
          >
            Вернуть автоматическую
          </button>
        )}
      </div>
      <p className="meta">
        То, что увидят до нажатия play. Можно выбрать кадр из видео или загрузить
        свою картинку. YouTube и Instagram примут и то и другое; TikTok обложку при
        загрузке во входящие не принимает — она выбирается в приложении.
      </p>

      {/* Скрытая копия: с неё снимаются кадры, не трогая видимое превью. */}
      <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" className="sr-only" />

      <div className="cover__row">
        <div className="cover__current">
          {uploadUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadUrl} alt="Загруженная обложка" />
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt={`Кадр на ${formatTimecode(effectiveMs)}`} />
          ) : (
            <span className="spinner" />
          )}
          <span className="cover__time">
            {coverFile ? "своя картинка" : formatTimecode(effectiveMs)}
          </span>
        </div>

        <div className="cover__controls">
          <label className="field__label" htmlFor="cover-range">
            Выбрать кадр {busy && <span className="meta">— снимаем…</span>}
          </label>
          <input
            id="cover-range"
            type="range"
            min={0}
            max={Math.max(0, durationMs - 1)}
            step={100}
            value={effectiveMs}
            disabled={disabled || Boolean(coverFile)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="cover__range"
          />
          <div className="cover__candidates">
            {candidates.map((c) => (
              <button
                key={c.ms}
                type="button"
                className="cover__cand"
                aria-pressed={valueMs === c.ms}
                aria-label={`Кадр на ${formatTimecode(c.ms)}`}
                disabled={disabled}
                onClick={() => onChange(c.ms)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt="" />
                <span>{formatTimecode(c.ms)}</span>
              </button>
            ))}
            {candidates.length === 0 && <span className="meta">Готовим кадры…</span>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--tool btn--sm"
              disabled={disabled || Boolean(coverFile)}
              onClick={() => onChange(effectiveMs)}
            >
              <Icon name="check" /> Взять этот кадр
            </button>
            <label className="btn btn--tool btn--sm" style={{ position: "relative", overflow: "hidden" }}>
              <Icon name="upload" /> {coverFile ? "Заменить картинку" : "Загрузить свою"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={disabled}
                onChange={(e) => onCoverFile(e.target.files?.[0] ?? null)}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              />
            </label>
          </div>
          {coverFile && (
            <p className="meta" style={{ marginTop: 6 }}>
              {coverFile.name} — используется вместо кадра.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
