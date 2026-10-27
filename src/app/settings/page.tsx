import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workerHealth } from "@/lib/redis";
import Icon from "@/components/Icon";

export const metadata: Metadata = { title: "Настройки" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const [me, worker, lastMetric] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, createdAt: true } }),
    workerHealth(),
    prisma.postMetric.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }),
  ]);
  const role = user.role === "OWNER" ? "Владелец" : user.role === "VIEWER" ? "Наблюдатель" : "Участник";

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic">
          <h1>Настройки</h1>
          <p className="lead">Вход, пароль и состояние сервера.</p>
        </div>
      </div>
      <div className="grid">
        <div className="z-basic stack">
          {sp.pw === "set" && (
            <div className="msg msg--ok" role="status">
              <Icon name="check" />
              <div className="msg__body">Пароль сохранён.</div>
            </div>
          )}

          <section className="panel stack-sm">
            <h2 style={{ fontSize: "var(--fs-lg)" }}>Ваш вход</h2>
            <dl className="spec">
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Роль</dt><dd>{role}</dd></div>
              <div><dt>Пароль</dt><dd>{me?.passwordHash ? "задан" : "не задан — вход по ссылке"}</dd></div>
            </dl>
          </section>

          <section className="panel stack-sm">
            <h2 style={{ fontSize: "var(--fs-lg)" }}>{me?.passwordHash ? "Сменить пароль" : "Задать пароль"}</h2>
            <form action="/api/auth/set-password" method="post" className="stack-sm">
              <p className="meta">Минимум 8 символов. С паролем можно входить без ссылки на почту.</p>
              <div className="field" style={{ maxWidth: 360 }}>
                <label className="field__label" htmlFor="new-pw">Новый пароль</label>
                <input id="new-pw" className="f" type="password" name="password" minLength={8} required autoComplete="new-password" />
              </div>
              <div><button className="btn btn--sm" type="submit">Сохранить</button></div>
            </form>
          </section>

          <section className="panel stack-sm">
            <h2 style={{ fontSize: "var(--fs-lg)" }}>Сервер</h2>
            <dl className="spec">
              <div>
                <dt>Обработчик публикаций</dt>
                <dd style={{ color: worker.alive ? "var(--ok)" : "var(--error)" }}>
                  {worker.alive ? "работает" : worker.reachable ? "не запущен" : "нет связи с Redis"}
                </dd>
              </div>
              <div><dt>Последний сбор охватов</dt><dd>{lastMetric ? fmt(lastMetric.fetchedAt) : "ещё не было"}</dd></div>
            </dl>
            {!worker.alive && (
              <p className="meta">
                Запустите всё одной командой: <code>npm run up</code>. Проверка: <code>npm run doctor</code>.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
