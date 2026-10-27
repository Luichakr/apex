import type { HistoryItem } from "@/lib/history";
import { engagementRate } from "@/lib/history";
import { fmtDateTime, fmtDur, fmtNum, fmtPct } from "@/lib/format";
import Icon from "./Icon";

type Col = { key: string; label: string; title: string; get: (i: HistoryItem) => number | null | undefined; pct?: boolean };

const COLS: Col[] = [
  { key: "views", label: "Просм.", title: "Просмотры", get: (i) => i.views },
  { key: "reach", label: "Охват", title: "Охват (уникальные)", get: (i) => i.reach },
  { key: "likes", label: "Лайки", title: "Лайки", get: (i) => i.likes },
  { key: "comments", label: "Комм.", title: "Комментарии", get: (i) => i.comments },
  { key: "unanswered", label: "Без отв.", title: "Комментарии без вашего ответа", get: (i) => i.unanswered },
  { key: "shares", label: "Репосты", title: "Репосты", get: (i) => i.shares },
  { key: "saves", label: "Сохр.", title: "Сохранения", get: (i) => i.saves },
  { key: "er", label: "ER", title: "Вовлечённость: реакции к просмотрам", get: (i) => engagementRate(i), pct: true },
];

/** Таблица публикаций: маленькая обложка, заголовок, дата и все показатели в колонках. */
export default function StatsTable({ items, vertical }: { items: HistoryItem[]; vertical?: boolean }) {
  // Колонки без единого значения прячем, чтобы не рисовать столбцы прочерков.
  const cols = COLS.filter((c) => items.some((i) => c.get(i) !== undefined && c.get(i) !== null));
  const sorted = [...items].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const avg = (c: Col) => {
    const vals = sorted.map(c.get).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgs = Object.fromEntries(cols.map((c) => [c.key, avg(c)]));

  return (
    <div className="st-wrap">
      <table className="st">
        <thead>
          <tr>
            <th className="st__post">Публикация</th>
            <th className="st__date">Дата</th>
            {cols.map((c) => (
              <th key={c.key} className="st__n" title={c.title}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((i) => (
            <tr key={i.id}>
              <td className="st__post">
                <a href={i.url} target="_blank" rel="noreferrer" className="st__link">
                  <span className={`st__thumb ${vertical ? "st__thumb--v" : ""}`}>
                    {i.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <Icon name="film" size={16} />
                    )}
                  </span>
                  <span className="st__title">
                    {i.title}
                    {i.durationSec !== undefined && <span className="st__dur"> · {fmtDur(i.durationSec)}</span>}
                  </span>
                </a>
              </td>
              <td className="st__date">{fmtDateTime(i.publishedAt)}</td>
              {cols.map((c) => {
                const v = c.get(i);
                const a = avgs[c.key];
                const above = typeof v === "number" && a !== null && a > 0 && v > a * 1.15;
                const below = typeof v === "number" && a !== null && a > 0 && v < a * 0.85;
                const warn = c.key === "unanswered" && typeof v === "number" && v > 0;
                return (
                  <td key={c.key} className="st__n" data-above={above && c.key !== "unanswered" ? "1" : undefined} data-below={below && c.key !== "unanswered" ? "1" : undefined} data-warn={warn ? "1" : undefined}>
                    {v === undefined || v === null ? <span className="muted">—</span> : c.pct ? fmtPct(v) : fmtNum(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {sorted.length > 1 && (
          <tfoot>
            <tr>
              <td className="st__post">Среднее на публикацию</td>
              <td className="st__date" />
              {cols.map((c) => {
                const a = avgs[c.key];
                return (
                  <td key={c.key} className="st__n">
                    {a === null ? "—" : c.pct ? fmtPct(a) : fmtNum(Math.round(a))}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
