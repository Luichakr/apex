import Link from "next/link";
import type { Period } from "@/lib/history";
import { ymd } from "@/lib/format";

const PRESETS: { key: Period["key"]; label: string }[] = [
  { key: "day", label: "Сегодня" },
  { key: "week", label: "7 дней" },
  { key: "month", label: "30 дней" },
  { key: "year", label: "Год" },
];

/** Переключатель периода: готовые отрезки и свой диапазон дат. */
export default function PeriodPicker({ period, base }: { period: Period; base: string }) {
  return (
    <div className="period">
      <nav className="tabs" aria-label="Период">
        {PRESETS.map((p) => (
          <Link key={p.key} href={`${base}?p=${p.key}`} aria-current={period.key === p.key ? "page" : undefined}>
            {p.label}
          </Link>
        ))}
        <span className="tabs__custom" aria-current={period.key === "custom" ? "page" : undefined}>Свой период</span>
      </nav>
      <form action={base} method="get" className="period__form">
        <input type="hidden" name="p" value="custom" />
        <label className="sr-only" htmlFor="from">С</label>
        <input id="from" className="f f--sm" type="date" name="from" defaultValue={ymd(period.from)} required />
        <span className="muted">—</span>
        <label className="sr-only" htmlFor="to">По</label>
        <input id="to" className="f f--sm" type="date" name="to" defaultValue={ymd(new Date(period.to.getTime() - 1))} required />
        <button type="submit" className="btn btn--tool btn--sm">Показать</button>
      </form>
    </div>
  );
}
