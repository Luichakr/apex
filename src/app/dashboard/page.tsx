import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workerHealth } from "@/lib/redis";
import { inPeriod, loadHistory, parsePeriod, totals, type HistoryItem } from "@/lib/history";
import { fmtDateTime, fmtNum, fmtPct } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "@/components/Icon";
import StatsTable from "@/components/StatsTable";
import AutoRefresh from "@/app/posts/auto-refresh";

export const metadata: Metadata = { title: "Обзор" };
export const dynamic = "force-dynamic";

function Kpi({ label, value, sub, warn, href }: { label: string; value: string; sub?: string; warn?: boolean; href?: string }) {
  const body = (
    <>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value" style={warn ? { color: "var(--warn)" } : undefined}>{value}</span>
      {sub && <span className="kpi__sub">{sub}</span>}
    </>
  );
  return href ? <Link href={href} className="kpi kpi--link">{body}</Link> : <div className="kpi">{body}</div>;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const ownerId = await dataOwnerId(user);
  const period = parsePeriod({ p: "month" });

  const [accounts, inWork, failed, worker, networks] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { userId: ownerId },
      select: { id: true, provider: true, displayName: true, needsReconnect: true, tokenExpiresAt: true, refreshTokenEnc: true },
      orderBy: { provider: "asc" },
    }),
    prisma.post.count({ where: { userId: ownerId, status: { in: ["PUBLISHING", "SCHEDULED"] } } }),
    prisma.postTarget.count({ where: { post: { userId: ownerId }, status: "FAILED" } }),
    workerHealth(),
    loadHistory(ownerId),
  ]);

  const all: HistoryItem[] = networks.flatMap((n) => n.items.filter((i) => inPeriod(i, period)));
  const t = totals(all);
  const er = t.hasViews && t.views > 0 ? ((t.likes + t.comments + t.shares + t.saves) / t.views) * 100 : null;
  const recent = [...networks.flatMap((n) => n.items)]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 8);
  const fetchedAt = networks.map((n) => n.fetchedAt).sort()[0];
  const soon = new Date(Date.now() + 7 * 86_400_000);
  const state = (a: (typeof accounts)[number]) =>
    a.needsReconnect ? "error" : !a.refreshTokenEnc && a.tokenExpiresAt && a.tokenExpiresAt < soon ? "warn" : "ok";
  const broken = accounts.filter((a) => state(a) !== "ok").length;
  const plural = (n: number, one: string, few: string, many: string) =>
    n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

  return (
    <main>
      {inWork > 0 && <AutoRefresh seconds={6} />}
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>Обзор</h1>
            <p className="lead">Итоги за 30 дней по всем сетям, состояние доступов и последние публикации.</p>
          </div>
          {fetchedAt && <span className="meta">Данные на {fmtDateTime(fetchedAt)}</span>}
        </div>
      </div>

      <div className="grid">
        <div className="z-basic stack">
          {!worker.alive && (
            <div className="msg msg--error" role="alert">
              <Icon name="alert" />
              <div className="msg__body">
                <p><b>Обработчик публикаций не запущен.</b> Видео будут ждать в очереди.</p>
                <p className="meta">Запустите всё командой <code>npm run up</code>.</p>
              </div>
            </div>
          )}

          <section className="stack-sm">
            <div className="between">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>За 30 дней</h2>
              <Link href="/history" className="link-arrow"><Icon name="arrow" /> Статистика по периодам</Link>
            </div>
            <div className="kpis kpis--6">
              <Kpi label="Публикаций" value={String(t.posts)} sub={inWork ? `ещё ${inWork} в работе` : "во всех сетях"} />
              <Kpi label="Просмотры" value={t.hasViews ? fmtNum(t.views) : "—"} sub={t.hasReach ? `охват ${fmtNum(t.reach)}` : "по данным сетей"} />
              <Kpi label="Лайки" value={fmtNum(t.likes)} />
              <Kpi
                label="Комментарии"
                value={fmtNum(t.comments)}
                sub={!t.hasUnanswered ? undefined : t.unanswered ? `без ответа: ${t.unanswered}` : "на все отвечено"}
                warn={t.unanswered > 0}
              />
              <Kpi label="Вовлечённость" value={er === null ? "—" : fmtPct(er)} sub="реакции к просмотрам" />
              <Kpi
                label="Ошибок публикации"
                value={String(failed)}
                sub={failed ? "нужно повторить" : "всё прошло"}
                warn={failed > 0}
                href={failed ? "/posts" : undefined}
              />
            </div>
          </section>

          <div className="two">
            <section className="stack-sm">
              <div className="between">
                <h2 style={{ fontSize: "var(--fs-lg)" }}>Сети</h2>
                <Link href="/accounts" className="link-arrow"><Icon name="arrow" /> Аккаунты</Link>
              </div>
              {accounts.length === 0 ? (
                <p className="muted">Ничего не подключено. <Link href="/accounts">Подключить сети</Link></p>
              ) : (
                <div className="nets nets--list">
                  {accounts.map((a) => {
                    const st = state(a);
                    const n = networks.find((x) => x.provider === a.provider);
                    const nt = n ? totals(n.items.filter((i) => inPeriod(i, period))) : null;
                    return (
                      <Link key={a.id} href="/accounts" className="net">
                        <span className="net__dot" data-state={st} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <div className="net__name">
                            {PROVIDER_LABEL[a.provider]} <span className="muted" style={{ fontWeight: 400 }}>· {a.displayName}</span>
                          </div>
                          <div className="net__sub">
                            {st === "error"
                              ? "нужно переподключить"
                              : st === "warn"
                                ? "доступ скоро истечёт"
                                : nt && nt.posts
                                  ? `${nt.posts} публ.${nt.hasViews ? ` · 👁 ${fmtNum(nt.views)}` : ""} · ❤ ${fmtNum(nt.likes)} · 💬 ${fmtNum(nt.comments)}`
                                  : n?.source === "network"
                                    ? "за 30 дней публикаций нет"
                                    : "статистика недоступна по API"}
                          </div>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="stack-sm">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Что сделать</h2>
              <ul className="todo">
                {t.unanswered > 0 && (
                  <li>
                    <Icon name="alert" />
                    <span>
                      Ответить на {t.unanswered} {plural(t.unanswered, "комментарий", "комментария", "комментариев")}.{" "}
                      <Link href="/history">Где именно</Link>
                    </span>
                  </li>
                )}
                {failed > 0 && (
                  <li><Icon name="alert" /> <span>Повторить {failed} {plural(failed, "неудачную публикацию", "неудачные публикации", "неудачных публикаций")}. <Link href="/posts">Открыть</Link></span></li>
                )}
                {broken > 0 && (
                  <li><Icon name="alert" /> <span>Переподключить {broken} {plural(broken, "сеть", "сети", "сетей")} с проблемой доступа. <Link href="/accounts">Аккаунты</Link></span></li>
                )}
                {inWork > 0 && (
                  <li><Icon name="clock" /> <span>{inWork} {plural(inWork, "публикация", "публикации", "публикаций")} в работе или по расписанию. <Link href="/calendar">Календарь</Link></span></li>
                )}
                {t.unanswered === 0 && failed === 0 && broken === 0 && inWork === 0 && (
                  <li><Icon name="check" /> <span>Всё в порядке. <Link href="/compose">Новый пост</Link></span></li>
                )}
              </ul>
            </section>
          </div>

          <section className="stack-sm">
            <div className="between">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Последние публикации</h2>
              <Link href="/history" className="link-arrow"><Icon name="arrow" /> Все со статистикой</Link>
            </div>
            {recent.length === 0 ? (
              <p className="muted">Пока ничего не опубликовано. <Link href="/compose">Создать первый пост</Link></p>
            ) : (
              <StatsTable items={recent} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
