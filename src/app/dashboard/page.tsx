import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workerHealth } from "@/lib/redis";
import Icon from "@/components/Icon";
import PostCard from "@/components/PostCard";
import AutoRefresh from "@/app/posts/auto-refresh";
import { PROVIDER_LABEL } from "@/lib/limits";

export const metadata: Metadata = { title: "Обзор" };
export const dynamic = "force-dynamic";

const fmtNum = (n: number) =>
  n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : `${Math.round(n / 1000)}k`;
const DAYS = 30;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const ownerId = await dataOwnerId(user);
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const [accounts, published, scheduled, failed, recent, worker, doneTargets] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { userId: ownerId },
      select: { id: true, provider: true, displayName: true, needsReconnect: true, tokenExpiresAt: true, refreshTokenEnc: true },
      orderBy: { provider: "asc" },
    }),
    prisma.post.count({ where: { userId: ownerId, status: { in: ["DONE", "PARTIAL"] }, createdAt: { gte: since } } }),
    prisma.post.count({ where: { userId: ownerId, status: { in: ["PUBLISHING", "SCHEDULED"] } } }),
    prisma.postTarget.count({ where: { post: { userId: ownerId }, status: "FAILED" } }),
    prisma.post.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { targets: { orderBy: { provider: "asc" }, include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } } } },
    }),
    workerHealth(),
    prisma.postTarget.findMany({
      where: { post: { userId: ownerId }, status: "DONE", createdAt: { gte: since } },
      select: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1, select: { views: true, reach: true, likes: true, comments: true } } },
    }),
  ]);

  // Охват за период: по каждой публикации берём последний замер.
  let views = 0, reactions = 0, measured = 0;
  for (const t of doneTargets) {
    const m = t.metrics[0];
    if (!m) continue;
    measured++;
    views += m.views ?? m.reach ?? 0;
    reactions += (m.likes ?? 0) + (m.comments ?? 0);
  }
  const pending = recent.some((p) => p.status === "PUBLISHING");
  const soon = new Date(Date.now() + 7 * 86_400_000);
  const state = (a: (typeof accounts)[number]) =>
    a.needsReconnect ? "error" : !a.refreshTokenEnc && a.tokenExpiresAt && a.tokenExpiresAt < soon ? "warn" : "ok";

  return (
    <main>
      {pending && <AutoRefresh seconds={4} />}
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>Обзор</h1>
            <p className="lead">Что вышло за {DAYS} дней, сколько это собрало и всё ли в порядке с доступами.</p>
          </div>
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
          {failed > 0 && (
            <div className="msg msg--error">
              <Icon name="alert" />
              <div className="msg__body">
                <p>Публикаций с ошибкой: <b>{failed}</b>.</p>
                <p><Link href="/posts" className="link-arrow"><Icon name="arrow" /> Посмотреть и повторить</Link></p>
              </div>
            </div>
          )}

          <section className="stack-sm">
            <div className="between">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>За {DAYS} дней</h2>
              <Link href="/history" className="link-arrow"><Icon name="arrow" /> Статистика по постам</Link>
            </div>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi__label">Опубликовано за {DAYS} дней</span>
              <span className="kpi__value">{published}</span>
              <span className="kpi__sub">{scheduled ? `ещё ${scheduled} в работе или по расписанию` : "ничего не ждёт"}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Просмотры и охват</span>
              <span className="kpi__value">{measured ? fmtNum(views) : "—"}</span>
              <span className="kpi__sub">{measured ? `по ${measured} публикациям` : "сбор раз в 6 часов"}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Лайки и комментарии</span>
              <span className="kpi__value">{measured ? fmtNum(reactions) : "—"}</span>
              <span className="kpi__sub">за те же публикации</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Ошибок</span>
              <span className="kpi__value" style={failed ? { color: "var(--error)" } : undefined}>{failed}</span>
              <span className="kpi__sub">{failed ? "нужно повторить" : "всё прошло"}</span>
            </div>
          </div>
          </section>

          <section className="stack-sm">
            <div className="between">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Сети</h2>
              <Link href="/accounts" className="link-arrow"><Icon name="arrow" /> Управлять</Link>
            </div>
            {accounts.length === 0 ? (
              <p className="muted">Ничего не подключено. <Link href="/accounts">Подключить сети</Link></p>
            ) : (
              <div className="nets">
                {accounts.map((a) => {
                  const st = state(a);
                  return (
                    <Link key={a.id} href="/accounts" className="net">
                      <span className="net__dot" data-state={st} />
                      <span style={{ minWidth: 0 }}>
                        <div className="net__name">{PROVIDER_LABEL[a.provider]}</div>
                        <div className="net__sub">
                          {st === "error" ? "нужно переподключить" : st === "warn" ? "доступ скоро истечёт" : a.displayName ?? "подключён"}
                        </div>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="stack-sm">
            <div className="between">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Последние публикации</h2>
              <Link href="/posts" className="link-arrow"><Icon name="arrow" /> Все публикации</Link>
            </div>
            {recent.length === 0 ? (
              <p className="muted">Пока ничего не опубликовано. <Link href="/compose">Создать первый пост</Link></p>
            ) : (
              recent.map((p) => <PostCard key={p.id} post={p} canEdit={user.role !== "VIEWER"} />)
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
