import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = { title: "Приглашения" };
export const dynamic = "force-dynamic";

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; deleted?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER") redirect("/dashboard");

  const sp = await searchParams;
  const env = getEnv();
  const invites = await prisma.invite.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();
  const loginUrl = new URL("/login", env.APP_URL).toString();

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic">
          <h1>Приглашения.</h1>
          <p className="lead">
            Сервис закрытый: новый человек входит только с кодом. Один код — один человек.
          </p>
        </div>
      </div>

      <div className="grid">
        <div className="z-basic stack">
          {sp.created && (
            <div className="msg msg--ok" role="status"><Icon name="check" /><div className="msg__body">Код создан — скопируйте и отправьте другу вместе со ссылкой входа.</div></div>
          )}
          {sp.deleted && (
            <div className="msg" role="status"><Icon name="info" /><div className="msg__body">Код удалён.</div></div>
          )}

          <section className="panel stack-sm" aria-labelledby="new-invite">
            <h2 id="new-invite" style={{ fontSize: "var(--fs-lg)" }}>Новый код.</h2>
            <form action="/api/invites" method="post" className="stack-sm">
              <div className="tiles tiles--2" style={{ gap: "var(--sp-sm)" }}>
                <div className="field">
                  <label className="field__label" htmlFor="inv-email">
                    Email друга <span className="opt">— необязательно</span>
                  </label>
                  <input id="inv-email" className="f" type="email" name="email" placeholder="friend@example.com" />
                  <span className="field__hint">Если указать, код сработает только для этого адреса.</span>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="inv-days">
                    Срок действия, дней <span className="opt">— необязательно</span>
                  </label>
                  <input id="inv-days" className="f" type="number" name="expiresDays" min={1} max={365} placeholder="Например, 14" inputMode="numeric" />
                  <span className="field__hint">Без срока код действует, пока его не используют.</span>
                </div>
              </div>
              <div><button className="btn btn--stretch-sm" type="submit">Создать код</button></div>
            </form>
          </section>

          <section aria-labelledby="list-invites" className="stack-sm">
            <h2 id="list-invites" style={{ fontSize: "var(--fs-lg)" }}>Выданные коды.</h2>
            <p className="meta">Ссылка для входа: <code>{loginUrl}</code></p>
            {invites.length === 0 ? (
              <p className="muted">Пока нет кодов.</p>
            ) : (
              <ul className="rows">
                {invites.map((inv) => {
                  const used = Boolean(inv.usedAt);
                  const expired = !used && inv.expiresAt && inv.expiresAt.getTime() < now;
                  return (
                    <li key={inv.id} className="between">
                      <div style={{ minWidth: 0 }}>
                        <code style={{ fontSize: "1rem" }}>{inv.code}</code>
                        <p className="meta" style={{ marginTop: 6 }}>
                          {inv.email ? `Для ${inv.email}` : "Для любого адреса"}
                          {inv.expiresAt && !used ? ` · до ${inv.expiresAt.toLocaleDateString("ru-RU")}` : ""}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        <span className={`tag ${used ? "" : expired ? "tag--warn" : "tag--ok"}`}>
                          {used ? `Использован${inv.usedByEmail ? ` · ${inv.usedByEmail}` : ""}` : expired ? "Просрочен" : "Активен"}
                        </span>
                        {!used && !expired && (
                          <CopyButton text={`Код приглашения в APEX: ${inv.code}\nВход: ${loginUrl}`} label="Скопировать" />
                        )}
                        {!used && (
                          <form action={`/api/invites/${inv.id}/delete`} method="post">
                            <button className="btn btn--tool btn--sm btn--danger" type="submit">Удалить</button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
