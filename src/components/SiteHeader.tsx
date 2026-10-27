import Link from "next/link";
import { getCurrentUser, canPublish } from "@/lib/auth";
import HeaderNav from "./HeaderNav";
import { Mark } from "./Icon";

/** Липкая шапка из матового стекла. Состав меню зависит от роли. */
export default async function SiteHeader() {
  const user = await getCurrentUser().catch(() => null);
  const items = user
    ? [
        { href: "/dashboard", label: "Кабинет" },
        { href: "/posts", label: "Публикации" },
        { href: "/history", label: "История" },
        { href: "/calendar", label: "Календарь" },
        { href: "/support", label: "Друзья" },
        { href: "/accounts", label: "Аккаунты" },
        ...(user.role === "OWNER" ? [{ href: "/invites", label: "Приглашения" }] : []),
      ]
    : [];

  return (
    <header className="hdr">
      <div className="grid hdr__in">
        <div className="z-wide hdr__bar">
          <Link href={user ? "/dashboard" : "/"} className="wordmark" aria-label="APEX — на главную">
            <Mark className="wordmark__mark" />
            APEX
          </Link>
          <HeaderNav items={items} signedIn={Boolean(user)} canPublish={user ? canPublish(user) : true} />
        </div>
      </div>
    </header>
  );
}
