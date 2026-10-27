import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Подтверждение входа", robots: { index: false } };

/**
 * Страница из письма. Вход происходит только по нажатию кнопки (POST), поэтому
 * почтовые сканеры, заранее открывающие ссылки, не «сжигают» одноразовый вход.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="grid section">
      <div className="z-narrow" style={{ maxWidth: 520 }}>
        <h1>Подтвердите вход</h1>
        {token ? (
          <form action="/api/auth/verify" method="post" className="stack" style={{ marginTop: "var(--sp-md)" }}>
            <p className="lead">Нажмите кнопку, чтобы войти в APEX на этом устройстве.</p>
            <input type="hidden" name="token" value={token} />
            <button className="btn btn--stretch-sm" type="submit">Войти</button>
          </form>
        ) : (
          <div className="stack" style={{ marginTop: "var(--sp-md)" }}>
            <p className="lead">В ссылке нет кода входа. Запросите новую ссылку.</p>
            <Link className="btn btn--stretch-sm" href="/login">К входу</Link>
          </div>
        )}
      </div>
    </main>
  );
}
