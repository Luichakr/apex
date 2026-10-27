"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon, { Mark } from "./Icon";

type NavItem = { href: string; label: string };

/** Навигация шапки: ссылки на десктопе, полноэкранное меню на телефоне. */
export default function HeaderNav({
  items,
  signedIn,
  canPublish = true,
}: {
  items: NavItem[];
  signedIn: boolean;
  canPublish?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Меню рендерится в <body>: у шапки backdrop-filter, а он «запирает»
  // position: fixed внутри себя.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href + "/"));

  // Закрываем меню при переходе, Escape и блокируем прокрутку под ним.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {items.length > 0 && (
        <nav className="hdr__nav" aria-label="Основная навигация">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="hdr__link"
              aria-current={isActive(i.href) ? "page" : undefined}
            >
              {i.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="hdr__actions">
        {signedIn ? (
          canPublish ? (
            <Link href="/compose" className="btn btn--sm hide-sm">
              <Icon name="plus" /> Новый пост
            </Link>
          ) : null
        ) : (
          <Link href="/login" className="btn btn--sm hide-sm">
            Войти
          </Link>
        )}
        <button
          type="button"
          className="btn btn--icon hdr__menu-btn"
          aria-label="Открыть меню"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={22} />
        </button>
      </div>

      {mounted && createPortal(<div
        id="mobile-menu"
        className="drawer"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Меню"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="drawer__top">
          <Link href="/" className="wordmark">
            <Mark className="wordmark__mark" />
            APX
          </Link>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <ul className="drawer__list">
          {(signedIn
            ? [...(canPublish ? [{ href: "/compose", label: "Новый пост" }] : []), ...items]
            : [{ href: "/", label: "Главная" }, { href: "/login", label: "Войти" }]
          ).map((i) => (
            <li key={i.href}>
              <Link href={i.href} aria-current={isActive(i.href) ? "page" : undefined}>
                {i.label}
                <Icon name="chevron" size={22} />
              </Link>
            </li>
          ))}
        </ul>
        {signedIn && (
          <div className="drawer__foot">
            <form action="/api/auth/logout" method="post">
              <button className="btn btn--tool btn--block" type="submit">
                <Icon name="logout" /> Выйти
              </button>
            </form>
          </div>
        )}
      </div>, document.body)}
    </>
  );
}
