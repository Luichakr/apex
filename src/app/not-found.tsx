import Link from "next/link";

/** 404 — единственная тёмная страница. */
export default function NotFound() {
  return (
    <main className="dark-page">
      <div>
        <div className="dark-page__num" aria-hidden>404</div>
        <h1 style={{ fontSize: "var(--fs-lg)", fontWeight: 400, marginTop: 16 }}>Такой страницы нет.</h1>
        <p style={{ color: "var(--dark-ink)", marginTop: 8 }}>Возможно, ссылка устарела.</p>
        <Link href="/" className="btn btn--frosted" style={{ marginTop: 28 }}>
          На главную
        </Link>
      </div>
    </main>
  );
}
