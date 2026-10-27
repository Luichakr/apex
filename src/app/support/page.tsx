import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROVIDER_LABEL } from "@/lib/limits";
import { DAILY_LIMIT, listSupportItems, supportDisabled } from "@/lib/support";
import { draftsAvailable } from "@/lib/support-draft";
import Icon from "@/components/Icon";
import SupportBox from "./support-box";
import ShareToggle from "./share-toggle";

export const metadata: Metadata = { title: "Поддержать друзей" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function SupportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowed = canPublish(user) && !supportDisabled();

  const [me, items, usedToday] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { shareForSupport: true } }),
    allowed ? listSupportItems(user.id) : Promise.resolve([]),
    allowed
      ? prisma.supportAction.count({
          where: { actorId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        })
      : Promise.resolve(0),
  ]);

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic">
          <h1>Поддержать друзей.</h1>
          <p className="lead">
            Лайк и тёплый комментарий под видео друзей — от вашего аккаунта, вручную, через официальный API.
          </p>
        </div>
      </div>

      <section className="grid">
        <div className="z-basic stack">
          {!canPublish(user) ? (
            <p className="meta">Наблюдатель не может ставить реакции.</p>
          ) : supportDisabled() ? (
            <p className="meta">Функция временно выключена владельцем.</p>
          ) : (
            <>
              <ShareToggle initial={me?.shareForSupport ?? false} />
              <p className="meta">
                <Icon name="shield" /> Сегодня использовано {usedToday} из {DAILY_LIMIT} действий. Лимит и паузы между
                действиями защищают аккаунты от блокировки: сети считают частые автоматические реакции спамом. Работает
                для YouTube и LinkedIn; если нужен другой аккаунт или права — переподключите его на странице «Аккаунты».
              </p>
              {items.length === 0 ? (
                <p className="lead">
                  Пока нечего поддерживать: друзья ещё не открыли свои публикации или за последние 2 недели ничего не вышло.
                </p>
              ) : (
                <ul className="rows">
                  {items.map(({ target: t, liked, commented }) => (
                    <li key={t.id}>
                      <article className="target">
                        <div className="target__head">
                          <span className="target__name">
                            {t.post.user.name ?? t.post.user.email.split("@")[0]} · {PROVIDER_LABEL[t.provider]}
                          </span>
                          {t.externalUrl && (
                            <a href={t.externalUrl} target="_blank" rel="noreferrer" className="link-arrow small">
                              <Icon name="external" /> Открыть
                            </a>
                          )}
                        </div>
                        <p className="meta">{fmt(t.createdAt)}</p>
                        <p className="post__caption">{(t.captionOverride ?? t.post.caption) || "Без текста"}</p>
                        <SupportBox targetId={t.id} liked={liked} commented={commented} canDraft={draftsAvailable()} />
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
