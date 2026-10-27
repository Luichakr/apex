"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

export type NavGroup = { title?: string; items: { href: string; label: string; icon: string; match?: string[] }[] };

/** Боковое меню: подсвечивает текущий раздел, включая вложенные страницы. */
export default function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = (href: string, match?: string[]) =>
    [href, ...(match ?? [])].some((h) => pathname === h || pathname.startsWith(h + "/"));
  return (
    <nav className="sb__nav" aria-label="Разделы">
      {groups.map((g, gi) => (
        <div key={gi} className="sb__group">
          {g.title && <div className="sb__title">{g.title}</div>}
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className="sb__link" aria-current={active(i.href, i.match) ? "page" : undefined}>
              <Icon name={i.icon} size={20} />
              <span>{i.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
