import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { Provider } from "@prisma/client";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { configuredProviders } from "@/lib/env";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import TelegramConnect from "@/components/TelegramConnect";
import { demoAccounts, isDemo } from "@/lib/demo";

export const metadata: Metadata = { title: "Аккаунты" };
export const dynamic = "force-dynamic";

const NETWORKS: {
  provider: Provider;
  key: "youtube" | "instagram" | "tiktok" | "meta" | "telegram" | "linkedin";
  name: string;
  format: string;
  how: string;
}[] = [
  {
    provider: "YOUTUBE",
    key: "youtube",
    name: "YouTube",
    format: "Shorts",
    how: "Публикуется сразу и публично. Первая строка текста — заголовок.",
  },
  {
    provider: "INSTAGRAM",
    key: "instagram",
    name: "Instagram",
    format: "Reels",
    how: "Публикуется сразу. Нужен профессиональный аккаунт (автор или бизнес).",
  },
  {
    provider: "TIKTOK",
    key: "tiktok",
    name: "TikTok",
    format: "Видео",
    how: "Видео приходит во входящие приложения TikTok — опубликуйте одним нажатием.",
  },
  {
    provider: "TELEGRAM",
    key: "telegram",
    name: "Telegram",
    format: "Канал и истории",
    how: "Подключается токеном бота. Истории требуют Telegram Premium и права «Управление историями».",
  },
  {
    provider: "LINKEDIN",
    key: "linkedin",
    name: "LinkedIn",
    format: "Видео в ленту",
    how: "Публикуется в ваш профиль. Отдельный инструмент — в новый пост по умолчанию не добавляется.",
  },
  {
    provider: "FACEBOOK",
    key: "meta",
    name: "Facebook",
    format: "Страница",
    how: "Видео на Страницу. Требует бизнес-верификации Meta.",
  },
];

const ERRORS: Record<string, string> = {
  bad_state: "Сессия подключения устарела. Нажмите «Подключить» ещё раз.",
  no_code: "Площадка не вернула код подтверждения. Попробуйте ещё раз.",
  access_denied: "Доступ не выдан — подключение отменено.",
  tiktok_not_configured: "TikTok не настроен на сервере.",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; disconnected?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const configured = configuredProviders();
  const ownerId = await dataOwnerId(user);
  const isViewer = user.role === "VIEWER";
  const accounts = (await isDemo()) ? demoAccounts() : await prisma.socialAccount.findMany({
    where: { userId: ownerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      displayName: true,
      tokenExpiresAt: true,
      createdAt: true,
      needsReconnect: true,
      reconnectReason: true,
    },
  });
  const visible = NETWORKS.filter(
    (n) => configured[n.key] || accounts.some((a) => a.provider === n.provider)
  );

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic">
          <h1>Аккаунты</h1>
          {isViewer && (
            <p className="lead" style={{ color: "var(--warn)" }}>
              Вы вошли как наблюдатель: видите, что подключено, но подключать и
              отключать сети нельзя.
            </p>
          )}
          <p className="lead">
            Сети, куда уходят видео. Подключение идёт на сайте самой сети, пароли сюда
            не вводятся. Если доступ слетел, нажмите «Переподключить».
          </p>
        </div>
      </div>

      <div className="grid">
        <div className="z-basic stack">
          {sp.connected && (
            <div className="msg msg--ok" role="status">
              <Icon name="check" />
              <div className="msg__body">Аккаунт подключён.</div>
            </div>
          )}
          {sp.disconnected && (
            <div className="msg" role="status">
              <Icon name="info" />
              <div className="msg__body">Аккаунт отключён, доступ отозван.</div>
            </div>
          )}
          {sp.error && (
            <div className="msg msg--error" role="alert">
              <Icon name="alert" />
              <div className="msg__body">{ERRORS[sp.error] ?? sp.error}</div>
            </div>
          )}

          <div className="tiles tiles--3">
            {visible.map((n) => {
              const mine = accounts.filter((a) => a.provider === n.provider);
              return (
                <section key={n.provider} className="tile" aria-labelledby={`net-${n.key}`}>
                  <div className="between">
                    <h2 id={`net-${n.key}`} style={{ fontSize: "var(--fs-lg)" }}>
                      {n.name}
                    </h2>
                    <span className="tag">{n.format}</span>
                  </div>
                  <p className="muted">{n.how}</p>

                  {mine.length > 0 && (
                    <ul className="rows" style={{ marginTop: 4 }}>
                      {mine.map((a) => {
                        const expired = a.needsReconnect;
                        return (
                          <li key={a.id} className="between">
                            <span style={{ minWidth: 0 }}>
                              <span className={`tag ${expired ? "tag--error" : "tag--ok"}`}>
                                <Icon name={expired ? "alert" : "check"} />
                                {expired ? "нужен повторный вход" : "подключён"}
                              </span>
                              <span style={{ display: "block", marginTop: 6, overflowWrap: "anywhere" }}>
                                {a.displayName ?? n.name}
                              </span>
                              {a.needsReconnect && a.reconnectReason && (
                                <span className="target__error" style={{ display: "block", marginTop: 4 }}>
                                  {a.reconnectReason}
                                </span>
                              )}
                            </span>
                            {!isViewer && (
                              <form action={`/api/accounts/${a.id}/disconnect`} method="post">
                                <button className="btn btn--tool btn--sm" type="submit">
                                  Отключить
                                </button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div style={{ marginTop: "auto", paddingTop: 8 }}>
                    {isViewer ? null : n.provider === "TELEGRAM" ? (
                      <TelegramConnect />
                    ) : configured[n.key] ? (
                      <a
                        className={mine.length ? "btn btn--tool btn--block" : "btn btn--block"}
                        href={`/api/connect/${n.key}/start`}
                      >
                        {mine.length ? "Переподключить" : `Подключить ${n.name}`}
                      </a>
                    ) : (
                      <span className="meta">Ключи площадки не заданы на сервере.</span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
