import type { HistoryItem } from "@/lib/history";
import { fmtPct } from "@/lib/format";

/**
 * «Ваше типичное видео»: средние доли по аккаунту, как в статистике Instagram
 * («Что влияет на число просмотров»). Доли считаются к просмотрам.
 */
type Rate = { key: string; label: string; of: (i: HistoryItem) => number | undefined; sec?: boolean };
const RATES: Rate[] = [
  { key: "like", label: "Доля лайков", of: (i) => i.likes },
  { key: "comment", label: "Доля комментариев", of: (i) => i.comments },
  { key: "save", label: "Доля сохранений", of: (i) => i.saves },
  { key: "share", label: "Доля репостов", of: (i) => i.shares },
  { key: "follow", label: "Подписки на 1000 просмотров", of: (i) => i.follows },
  { key: "watch", label: "Среднее время просмотра", of: (i) => i.avgWatchSec, sec: true },
  { key: "ret", label: "Досмотр", of: (i) => i.retentionPct },
];

function avgRate(items: HistoryItem[], r: Rate): number | null {
  if (r.sec || r.key === "ret") {
    const v = items.map(r.of).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  let num = 0, den = 0, any = false;
  for (const i of items) {
    const x = r.of(i);
    if (x === undefined || !i.views) continue;
    any = true; num += x; den += i.views;
  }
  if (!any || !den) return null;
  return r.key === "follow" ? (num / den) * 1000 : (num / den) * 100;
}

export function typicalRates(items: HistoryItem[]) {
  return RATES.map((r) => ({ ...r, value: avgRate(items, r) })).filter((r) => r.value !== null);
}

export default function TypicalVideo({ items, recent }: { items: HistoryItem[]; recent?: HistoryItem[] }) {
  const base = typicalRates(items);
  if (base.length === 0) return null;
  const last = recent && recent.length ? typicalRates(recent) : null;
  const fmt = (r: Rate, v: number) => (r.sec ? `${Math.round(v * 10) / 10} с` : r.key === "follow" ? (Math.round(v * 10) / 10).toString() : fmtPct(v));
  return (
    <div className="typ">
      {base.map((r) => {
        const cur = last?.find((x) => x.key === r.key)?.value ?? null;
        const diff = cur !== null && r.value ? cur / r.value - 1 : null;
        return (
          <div key={r.key} className="typ__item">
            <span className="typ__label">{r.label}</span>
            <span className="typ__value">{fmt(r, r.value!)}</span>
            {diff !== null && Math.abs(diff) >= 0.1 && (
              <span className="typ__diff" data-up={diff > 0 ? "1" : "0"}>
                {diff > 0 ? "▲" : "▼"} {Math.round(Math.abs(diff) * 100)}% за период
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
