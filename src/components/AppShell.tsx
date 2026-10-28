import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { canPublish } from "@/lib/auth";
import Icon, { Mark } from "./Icon";
import SideNav, { type NavGroup } from "./SideNav";
import HeaderNav from "./HeaderNav";
import { isDemo } from "@/lib/demo";

/**
 * Каркас приложения для вошедшего пользователя: боковое меню слева, контент
 * на всю оставшуюся ширину. На телефоне меню прячется в шапку.
 */
export default async function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const publish = canPublish(user);
  const demo = await isDemo();
  const groups: NavGroup[] = [
    {
      items: [
        { href: "/dashboard", label: "Обзор", icon: "home" },
        { href: "/posts", label: "Публикации", icon: "list", match: ["/calendar"] },
        { href: "/history", label: "Статистика", icon: "chart" },
        { href: "/accounts", label: "Аккаунты", icon: "link" },
      ],
    },
    {
      title: "Ещё",
      items: [
        ...(publish ? [{ href: "/support", label: "Поддержать друзей", icon: "heart" }] : []),
        ...(user.role === "OWNER" ? [{ href: "/invites", label: "Приглашения", icon: "users" }] : []),
        { href: "/settings", label: "Настройки", icon: "settings" },
      ],
    },
  ];
  const flat = groups.flatMap((g) => g.items.map(({ href, label }) => ({ href, label })));

  return (
    <div className="app">
      <aside className="sb">
        <Link href="/dashboard" className="wordmark sb__brand" aria-label="APX — обзор">
          <Mark className="wordmark__mark" />
          APX
        </Link>
        {publish && (
          <Link href="/compose" className="btn sb__new">
            <Icon name="plus" /> Новый пост
          </Link>
        )}
        <SideNav groups={groups} />
        <div className="sb__foot">
          <form action="/api/demo" method="post">
            <input type="hidden" name="on" value={demo ? "0" : "1"} />
            <button type="submit" className="sb__link" aria-pressed={demo}>
              <Icon name="eye" size={20} /><span>{demo ? "Выключить демо" : "Демо-режим"}</span>
            </button>
          </form>
          <div className="sb__user" title={user.email}>{user.name ?? user.email}</div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="sb__link sb__logout"><Icon name="logout" size={20} /><span>Выйти</span></button>
          </form>
        </div>
      </aside>

      <div className="app__main">
        <header className="topbar">
          <Link href="/dashboard" className="wordmark" aria-label="APX — обзор">
            <Mark className="wordmark__mark" />
            APX
          </Link>
          <HeaderNav items={flat} signedIn canPublish={publish} />
        </header>
        {demo && (
          <div className="demobar" role="status">
            <span><b>Демо-режим.</b> Все цифры и публикации вымышленные, как будто APX работает полгода. Публикация и подключение сетей в демо не работают.</span>
            <form action="/api/demo" method="post">
              <input type="hidden" name="on" value="0" />
              <button type="submit" className="btn btn--tool btn--sm">Выключить</button>
            </form>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
