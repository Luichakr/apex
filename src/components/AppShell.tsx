import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { canPublish } from "@/lib/auth";
import Icon, { Mark } from "./Icon";
import SideNav, { type NavGroup } from "./SideNav";
import HeaderNav from "./HeaderNav";

/**
 * Каркас приложения для вошедшего пользователя: боковое меню слева, контент
 * на всю оставшуюся ширину. На телефоне меню прячется в шапку.
 */
export default function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const publish = canPublish(user);
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
        <Link href="/dashboard" className="wordmark sb__brand" aria-label="APEX — обзор">
          <Mark className="wordmark__mark" />
          APEX
        </Link>
        {publish && (
          <Link href="/compose" className="btn sb__new">
            <Icon name="plus" /> Новый пост
          </Link>
        )}
        <SideNav groups={groups} />
        <div className="sb__foot">
          <div className="sb__user" title={user.email}>{user.name ?? user.email}</div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="sb__link sb__logout"><Icon name="logout" size={20} /><span>Выйти</span></button>
          </form>
        </div>
      </aside>

      <div className="app__main">
        <header className="topbar">
          <Link href="/dashboard" className="wordmark" aria-label="APEX — обзор">
            <Mark className="wordmark__mark" />
            APEX
          </Link>
          <HeaderNav items={flat} signedIn canPublish={publish} />
        </header>
        {children}
      </div>
    </div>
  );
}
