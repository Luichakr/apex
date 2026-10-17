import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Условия использования" };

export default function TermsPage() {
  const env = getEnv();
  const contact = env.OWNER_EMAIL || "owner@example.com";
  const app = env.APP_NAME;

  return (
    <main className="grid section">
      <article className="z-narrow prose">
      <h1>Условия использования.</h1>
      <p className="lead" style={{ marginTop: "var(--sp-sm)" }}>Сервис: {app}. Контакт: {contact}.</p>

      <h2>Назначение</h2>
      <p>
        {app} помогает публиковать ваши видео одновременно в несколько социальных
        сетей. Доступ предоставляется по приглашению.
      </p>

      <h2>Ваши обязательства</h2>
      <ul>
        <li>Вы публикуете только тот контент, на который имеете права.</li>
        <li>Вы соблюдаете правила площадок (Facebook, Instagram, YouTube, TikTok).</li>
        <li>Вы отвечаете за содержимое своих публикаций.</li>
      </ul>

      <h2>Доступы к соцсетям</h2>
      <p>
        Подключая соцсеть, вы разрешаете сервису публиковать контент от вашего имени
        по вашему запросу. Вы можете отозвать доступ в любой момент (отключить аккаунт).
      </p>

      <h2>Ограничение ответственности</h2>
      <p>
        Сервис предоставляется «как есть». Оператор не отвечает за действия площадок,
        изменения их API, блокировки или ограничения с их стороны.
      </p>

      <h2>Контакт</h2>
      <p>По вопросам: {contact}.</p>

      <p className="muted" style={{ marginTop: 32 }}>
        <a href="/privacy">Политика конфиденциальности</a>
      </p>
      </article>
    </main>
  );
}
