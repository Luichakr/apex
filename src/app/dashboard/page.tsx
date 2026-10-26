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

export const metadata: Metadata = { title: "Кабинет" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ pw?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;

  const ownerId = await dataOwnerId(user);
  const [accounts, total, inWork, failed, recent, worker] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { userId: ownerId },
      select: { provider: true, displayName: true },
    }),
    prisma.post.count({ where: { userId: ownerId } }),
    prisma.post.count({ where: { userId: ownerId, status: { in: ["PUBLISHING", "SCHEDULED"] } } }),
    prisma.postTarget.count({ where: { post: { userId: ownerId }, status: "FAILED" } }),
    prisma.post.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        targets: {
          orderBy: { provider: "asc" },
          include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
        },
      },
    }),
    workerHealth(),
  ]);
  const networks = [...new Set(accounts.map((a) => PROVIDER_LABEL[a.provider]))];
  const pending = recent.some((p) => p.status === "PUBLISHING");

  return (
    <main>
      {pending && <AutoRefresh seconds={4} />}
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow">{user.role === "OWNER" ? "Владелец" : user.role === "VIEWER" ? "Наблюдатель" : "Участник"}</p>
            <h1 style={{ marginTop: 8 }}>Здравствуйте{user.name ? `, ${user.name}` : ""}.</h1>
            <p className="meta" style={{ marginTop: 6 }}>{user.email}</p>
          </div>
          <div className="row">
            {user.role !== "VIEWER" && (
              <Link href="/compose" className="btn btn--stretch-sm">
                <Icon name="plus" /> Новый пост
              </Link>
            )}
            <form action="/api/auth/logout" method="post" className="hide-mobile">
              <button className="btn btn--tool" type="submit">Выйти</button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="z-basic stack">
          <div className="panel">
            <dl className="spec spec--big">
              <div><dt>Подключено сетей</dt><dd>{networks.length}</dd></div>
              <div><dt>Публикаций</dt><dd>{total}</dd></div>
              <div><dt>В работе</dt><dd>{inWork}</dd></div>
              <div><dt>Ошибок</dt><dd style={failed ? { color: "var(--error)" } : undefined}>{failed}</dd></div>
            </dl>
          </div>

          {!worker.alive && (
            <div className="msg msg--error" role="alert">
              <Icon name="alert" />
              <div className="msg__body">
                <p>
                  <b>Обработчик публикаций не отвечает.</b>{" "}
                  {worker.reachable
                    ? "Новые публикации будут ждать в очереди, пока он не запустится."
                    : "Нет связи с Redis — очередь недоступна."}
                </p>
                <p className="meta">
                  Запустите его командой <code>npm run worker</code> (или{" "}
                  <code>docker compose up -d worker</code>), затем проверьте всё командой{" "}
                  <code>npm run doctor</code>.
                </p>
              </div>
            </div>
          )}

          {failed > 0 && (
            <div className="msg msg--error">
              <Icon name="alert" />
              <div className="msg__body">
                <p>
                  Публикаций с ошибкой: <b>{failed}</b>. Их можно повторить одной кнопкой.
                </p>
                <p><Link href="/posts" className="link-arrow"><Icon name="arrow" /> Открыть публикации</Link></p>
              </div>
            </div>
          )}

          {accounts.length === 0 ? (
            <div className="msg">
              <Icon name="link" />
              <div className="msg__body">
                <p>Подключите YouTube, Instagram или TikTok — и можно публиковать.</p>
                <p><Link href="/accounts" className="link-arrow"><Icon name="arrow" /> К аккаунтам</Link></p>
              </div>
            </div>
          ) : (
            <p className="muted">
              Подключено: {networks.join(", ")}. <Link href="/accounts">Управлять</Link>
            </p>
          )}

          {sp.pw === "set" && (
            <div className="msg msg--ok" role="status">
              <Icon name="check" />
              <div className="msg__body">Пароль сохранён. Теперь можно входить по email и паролю.</div>
            </div>
          )}

          <details className="panel" style={{ padding: "4px var(--sp-md)" }}>
            <summary style={{ cursor: "pointer", minHeight: 52, display: "flex", alignItems: "center" }}>
              Пароль для входа
            </summary>
            <form action="/api/auth/set-password" method="post" className="stack-sm" style={{ paddingBottom: "var(--sp-md)" }}>
              <p className="meta">
                Вход по email и паролю — удобно, когда почта не настроена. Минимум 8 символов.
              </p>
              <div className="field" style={{ maxWidth: 360 }}>
                <label className="field__label" htmlFor="new-pw">Новый пароль</label>
                <input id="new-pw" className="f" type="password" name="password" minLength={8} required autoComplete="new-password" placeholder="Минимум 8 символов" />
              </div>
              <div><button className="btn btn--stretch-sm" type="submit">Сохранить пароль</button></div>
            </form>
          </details>

          <div className="between" style={{ marginTop: "var(--sp-lg)" }}>
            <h2>Последние публикации.</h2>
            {total > 3 && (
              <Link href="/posts" className="link-arrow"><Icon name="arrow" /> Все публикации</Link>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="muted">Пока ничего не опубликовано.</p>
          ) : (
            recent.map((p) => <PostCard key={p.id} post={p} canEdit={user.role !== "VIEWER"} />)
          )}
        </div>
      </div>
    </main>
  );
}
