import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { loadHistory } from "@/lib/history";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "@/components/Icon";

export const metadata: Metadata = { title: "История" };
export const dynamic = "force-dynamic";

const fmtDate = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(iso))
    : "";
const fmtNum = (n: number) =>
  n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const fresh = (await searchParams).fresh === "1";
  const networks = await loadHistory(await dataOwnerId(user), fresh);

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>История.</h1>
            <p className="lead">Последние 5 публикаций каждой сети — прямо из самих сетей, со статистикой.</p>
          </div>
          <Link href="/history?fresh=1" className="btn btn--tool btn--stretch-sm">
            <Icon name="refresh" /> Обновить
          </Link>
        </div>
      </div>

      <section className="grid">
        <div className="z-basic stack">
          {networks.length === 0 && (
            <p className="lead">Нет подключённых аккаунтов. <Link href="/accounts">Подключить</Link></p>
          )}
          {networks.map((n) => (
            <div key={`${n.provider}-${n.account}`} className="stack-sm">
              <div className="between">
                <h2 style={{ fontSize: "var(--fs-lg)" }}>
                  {PROVIDER_LABEL[n.provider]} <span className="muted" style={{ fontWeight: 400 }}>· {n.account}</span>
                </h2>
                <span className={`tag ${n.source === "network" ? "tag--ok" : ""}`}>
                  {n.source === "network" ? "из сети" : "из APEX"}
                </span>
              </div>
              {n.note && <p className="meta">{n.note}</p>}
              {n.items.length === 0 ? (
                <p className="muted">Публикаций нет.</p>
              ) : (
                <ul className="rows">
                  {n.items.map((i) => (
                    <li key={i.id}>
                      <article className="post" style={{ alignItems: "center" }}>
                        <div className="post__media">
                          {i.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className={n.provider === "YOUTUBE" ? "poster poster--wide" : "poster"} src={i.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            <div className={n.provider === "YOUTUBE" ? "poster poster--wide" : "poster"}><Icon name="film" /></div>
                          )}
                        </div>
                        <div className="stack-sm" style={{ minWidth: 0 }}>
                          <div className="between">
                            <span className="meta">{fmtDate(i.publishedAt)}{i.kind ? ` · ${i.kind}` : ""}</span>
                            {i.url && (
                              <a href={i.url} target="_blank" rel="noreferrer" className="link-arrow small">
                                <Icon name="external" /> Открыть
                              </a>
                            )}
                          </div>
                          <p className="post__caption">{i.title}</p>
                          <p className="target__detail">
                            {[
                              i.views !== undefined && `👁 ${fmtNum(i.views)}`,
                              i.reach !== undefined && `охват ${fmtNum(i.reach)}`,
                              i.likes !== undefined && `❤ ${fmtNum(i.likes)}`,
                              i.comments !== undefined && `💬 ${fmtNum(i.comments)}`,
                              i.shares !== undefined && `↗ ${fmtNum(i.shares)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Статистику сеть не отдаёт"}
                          </p>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
