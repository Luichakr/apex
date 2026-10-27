import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

/** Футер: всегда тёмный, колонки сверху, вордмарк в самом низу. */
export default async function SiteFooter() {
  const user = await getCurrentUser().catch(() => null);
  const year = new Date().getFullYear();
  return (
    <footer className="ftr">
      <div className="grid">
        <div className="z-basic">
          <div className="ftr__cols">
            <div>
              <div className="ftr__h">Публикация</div>
              <ul className="ftr__list">
                <li><Link href={user ? "/compose" : "/login"}>Новый пост</Link></li>
                <li><Link href={user ? "/posts" : "/login"}>Публикации</Link></li>
                <li><Link href={user ? "/accounts" : "/login"}>Аккаунты</Link></li>
              </ul>
            </div>
            <div>
              <div className="ftr__h">Сети</div>
              <ul className="ftr__list">
                <li>YouTube Shorts</li>
                <li>Instagram Reels</li>
                <li>TikTok</li>
                <li>Telegram</li>
                <li>LinkedIn</li>
              </ul>
            </div>
            <div>
              <div className="ftr__h">Документы</div>
              <ul className="ftr__list">
                <li><Link href="/privacy">Конфиденциальность</Link></li>
                <li><Link href="/terms">Условия использования</Link></li>
                <li>{user ? <Link href="/dashboard">Кабинет</Link> : <Link href="/login">Войти</Link>}</li>
              </ul>
            </div>
          </div>
          <p className="ftr__legal">
            Закрытый сервис для своих. Публикация идёт только через официальные API
            площадок, доступы к аккаунтам хранятся зашифрованными и отзываются при
            отключении. YouTube, Instagram, TikTok, Telegram и LinkedIn — товарные знаки их владельцев;
            сервис с ними не аффилирован. · <Link href="/privacy">Конфиденциальность</Link>{" "}
            · <Link href="/terms">Условия</Link> · © {year}
          </p>
          <div className="ftr__mark" aria-hidden>APX</div>
        </div>
      </div>
    </footer>
  );
}
