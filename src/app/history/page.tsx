import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { loadHistory, type HistoryItem } from "@/lib/history";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "@/components/Icon";

export const metadata: Metadata = { title: "История" };
export const dynamic = "force-dynamic";

const fmtDate = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(new Date(iso))
    : "";
const fmtNum = (n: number) =>
  n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`;
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Вовлечённость: (лайки + комментарии + репосты + сохранения) к просмотрам, в процентах. */
function engagement(i: HistoryItem): string | null {
  const base = i.views ?? i.reach;
  if (!base) return null;
  const act = (i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0) + (i.saves ?? 0);
  return `${((act / base) * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function Stat({ icon, value, title }: { icon: string; value?: number; title: string }) {
  if (value === undefined) return null;
  return (
    <span className="hc__stat" title={title}>
      <span aria-hidden>{icon}</span> {fmtNum(value)}
      <span className="sr-only"> {title}</span>
    </span>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const fresh = (await searchParams).fresh === "1";
  const networks = await loadHistory(await dataOwnerId(user), fresh);

  return (
    <main>
      <div className="grid page-head">
        <div className="z-wide between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>История.</h1>
            <p className="lead">Последние 5 публикаций каждой сети со статистикой.</p>
          </div>
          <Link href="/history?fresh=1" className="btn btn--tool btn--stretch-sm">
            <Icon name="refresh" /> Обновить
          </Link>
        </div>
      </div>

      <section className="grid">
        <div className="z-wide stack">
          {networks.length === 0 && (
            <p className="lead">Нет подключённых аккаунтов. <Link href="/accounts">Подключить</Link></p>
          )}
          {networks.map((n) => {
            const sum = (k: keyof HistoryItem) =>
              n.items.reduce((a, i) => a + (typeof i[k] === "number" ? (i[k] as number) : 0), 0);
            const hasViews = n.items.some((i) => i.views !== undefined);
            const viewsOf = (i: HistoryItem) => i.views ?? i.reach;
            const known = n.items.map(viewsOf).filter((v): v is number => v !== undefined);
            const avg = known.length >= 3 ? known.reduce((a, b) => a + b, 0) / known.length : null;
            return (
              <div key={`${n.provider}-${n.account}`} className="stack-sm">
                <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
                  <h2 style={{ fontSize: "var(--fs-lg)" }}>
                    {PROVIDER_LABEL[n.provider]} <span className="muted" style={{ fontWeight: 400 }}>· {n.account}</span>
                  </h2>
                  {n.items.length > 0 && (
                    <span className="meta">
                      Всего:{hasViews ? ` 👁 ${fmtNum(sum("views"))} ·` : ""} ❤ {fmtNum(sum("likes"))} · 💬 {fmtNum(sum("comments"))}
                      {n.items.some((i) => i.shares !== undefined) ? ` · ↗ ${fmtNum(sum("shares"))}` : ""}
                    </span>
                  )}
                </div>
                {n.note && <p className="meta">{n.note}</p>}
                {n.items.length === 0 ? (
                  n.note ? null : <p className="muted">Публикаций нет.</p>
                ) : (
                  <ul className="hist">
                    {n.items.map((i) => {
                      const eng = engagement(i);
                      const Tag = i.url ? "a" : "div";
                      return (
                        <li key={i.id}>
                          <Tag {...(i.url ? { href: i.url, target: "_blank", rel: "noreferrer" } : {})} className="hc">
                            <span className="hc__cover">
                              {i.thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={i.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                              ) : (
                                <Icon name="film" />
                              )}
                              {(i.views ?? i.reach) !== undefined && (
                                <span className="hc__views">👁 {fmtNum((i.views ?? i.reach)!)}</span>
                              )}
                              {avg && viewsOf(i) !== undefined && Math.abs(viewsOf(i)! / avg - 1) >= 0.15 && (
                                <span className="hc__vs" data-up={viewsOf(i)! > avg ? "1" : "0"} title="к среднему по этим пяти постам">
                                  {viewsOf(i)! > avg ? "▲" : "▼"} {Math.round(Math.abs(viewsOf(i)! / avg - 1) * 100)}%
                                </span>
                              )}
                              {i.durationSec !== undefined && <span className="hc__dur">{fmtDur(i.durationSec)}</span>}
                            </span>
                            <span className="hc__title">{i.title}</span>
                            <span className="hc__date">{fmtDate(i.publishedAt)}{i.kind ? ` · ${i.kind.toLowerCase()}` : ""}</span>
                            <span className="hc__stats">
                              <Stat icon="❤" value={i.likes} title="лайки" />
                              <Stat icon="💬" value={i.comments} title="комментарии" />
                              <Stat icon="↗" value={i.shares} title="репосты" />
                              <Stat icon="🔖" value={i.saves} title="сохранения" />
                              {i.reach !== undefined && i.views !== undefined && <Stat icon="◎" value={i.reach} title="охват" />}
                              {eng && <span className="hc__stat" title="вовлечённость">⚡ {eng}</span>}
                            </span>
                          </Tag>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
