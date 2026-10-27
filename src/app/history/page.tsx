import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { inPeriod, loadHistory, parsePeriod, totals, type HistoryItem } from "@/lib/history";
import { fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "@/components/Icon";
import StatsTable from "@/components/StatsTable";
import PeriodPicker from "@/components/PeriodPicker";

export const metadata: Metadata = { title: "Статистика" };
export const dynamic = "force-dynamic";

type Q = { p?: string; from?: string; to?: string; fresh?: string };

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value" style={warn ? { color: "var(--warn)" } : undefined}>{value}</span>
      {sub && <span className="kpi__sub">{sub}</span>}
    </div>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<Q> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const q = await searchParams;
  const period = parsePeriod(q);
  const networks = await loadHistory(await dataOwnerId(user), q.fresh === "1");

  const all: HistoryItem[] = networks.flatMap((n) => n.items.filter((i) => inPeriod(i, period)));
  const t = totals(all);
  const er = t.hasViews && t.views > 0 ? ((t.likes + t.comments + t.shares + t.saves) / t.views) * 100 : null;
  const fetchedAt = networks.map((n) => n.fetchedAt).sort()[0];
  const keep = period.key === "custom" ? `?p=custom&from=${q.from}&to=${q.to}` : `?p=${period.key}`;

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>Статистика</h1>
            <p className="lead">Цифры из самих сетей по каждой публикации за выбранный период.</p>
          </div>
          <div className="row">
            {fetchedAt && <span className="meta">Данные на {fmtDateTime(fetchedAt)}</span>}
            <Link href={`/history${keep}&fresh=1`} className="btn btn--tool btn--sm">
              <Icon name="refresh" /> Обновить
            </Link>
          </div>
        </div>
      </div>

      <section className="grid">
        <div className="z-basic stack">
          <PeriodPicker period={period} base="/history" />

          <div className="kpis kpis--6">
            <Kpi label={`Публикаций · ${period.label}`} value={String(t.posts)} />
            <Kpi label="Просмотры" value={t.hasViews ? fmtNum(t.views) : "—"} sub={t.hasReach ? `охват ${fmtNum(t.reach)}` : undefined} />
            <Kpi label="Лайки" value={fmtNum(t.likes)} />
            <Kpi
              label="Комментарии"
              value={fmtNum(t.comments)}
              sub={t.hasUnanswered ? (t.unanswered ? `без ответа: ${t.unanswered}` : "на все отвечено") : undefined}
              warn={t.hasUnanswered && t.unanswered > 0}
            />
            <Kpi label="Репосты и сохранения" value={t.hasShares || t.hasSaves ? fmtNum(t.shares + t.saves) : "—"} />
            <Kpi label="Вовлечённость" value={er === null ? "—" : fmtPct(er)} sub="реакции к просмотрам" />
          </div>

          {networks.length === 0 && (
            <p className="lead">Нет подключённых аккаунтов. <Link href="/accounts">Подключить</Link></p>
          )}
          {networks.map((n) => {
            const items = n.items.filter((i) => inPeriod(i, period));
            const nt = totals(items);
            return (
              <section key={`${n.provider}-${n.account}`} className="stack-sm">
                <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <h2 style={{ fontSize: "var(--fs-lg)" }}>
                    {PROVIDER_LABEL[n.provider]} <span className="muted" style={{ fontWeight: 400 }}>· {n.account}</span>
                  </h2>
                  {items.length > 0 && (
                    <span className="meta">
                      {nt.posts} публ.{nt.hasViews ? ` · 👁 ${fmtNum(nt.views)}` : ""} · ❤ {fmtNum(nt.likes)} · 💬 {fmtNum(nt.comments)}
                      {nt.hasUnanswered && nt.unanswered ? ` · без ответа ${nt.unanswered}` : ""}
                    </span>
                  )}
                </div>
                {n.note && <p className="meta">{n.note}</p>}
                {items.length === 0 ? (
                  !n.note && <p className="muted">За этот период публикаций нет.</p>
                ) : (
                  <StatsTable items={items} vertical={n.provider !== "YOUTUBE"} />
                )}
              </section>
            );
          })}
          <p className="meta">
            Период считается по дате публикации (время киевское). Сеть отдаёт не больше 30 последних публикаций,
            поэтому за год могут быть видны не все.
          </p>
        </div>
      </section>
    </main>
  );
}
