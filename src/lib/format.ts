/** Короткие форматы чисел и дат для таблиц статистики. */
const TZ = "Europe/Kyiv";

export const fmtNum = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? `${(n / 1000).toFixed(1).replace(".0", "")}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;

export const fmtPct = (n: number): string => `${n.toFixed(1).replace(/\.0$/, "")}%`;

export const fmtDur = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export const fmtDay = (iso?: string | Date): string =>
  iso ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: TZ }).format(new Date(iso)) : "";

export const fmtDateTime = (iso?: string | Date): string =>
  iso
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso))
    : "";

/** Дата как YYYY-MM-DD в киевском поясе (для полей ввода). */
export const ymd = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
