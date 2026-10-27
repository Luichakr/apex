import Link from "next/link";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { getCurrentUser } from "@/lib/auth";

/** Главная для невошедших. Кто вошёл — сразу в Обзор. */
export default async function HomePage() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");

  return (
    <main>
      <section className="grid hero">
        <div className="z-basic">
          <p className="eyebrow">Кросс-постинг видео</p>
          <h1 className="hero__title" style={{ marginTop: 12 }}>
            Одно видео — во все ваши сети. Без потери качества.
          </h1>
          <p className="lead hero__lead">
            Загрузите ролик один раз. APX подготовит версию под требования каждой
            сети и опубликует её через официальные API: YouTube, Instagram, TikTok,
            Telegram, LinkedIn.
          </p>
          <div className="row hero__cta">
            <Link href="/login" className="btn btn--stretch-sm">Войти</Link>
            <a href="#flow" className="link-arrow"><Icon name="arrow" /> Как это работает</a>
          </div>
        </div>
      </section>

      <section className="band section" id="flow">
        <div className="grid">
          <div className="z-basic">
            <h2>Как это работает</h2>
            <div className="flow" style={{ marginTop: "var(--sp-md)" }}>
              <div className="flow__item">
                <span className="meta">01</span>
                <h3>Загрузка</h3>
                <p>Файл с телефона или камеры как есть: MOV, MP4, HEVC, HDR, 4K, 60 fps.</p>
              </div>
              <div className="flow__item">
                <span className="meta">02</span>
                <h3>Версии под сети</h3>
                <p>Оригинал не меняется. Под каждую сеть готовится своя копия по её правилам.</p>
              </div>
              <div className="flow__item">
                <span className="meta">03</span>
                <h3>Публикация</h3>
                <p>Сразу или по расписанию. Повторы при сбое безопасны, без дублей.</p>
              </div>
              <div className="flow__item">
                <span className="meta">04</span>
                <h3>Статистика</h3>
                <p>Просмотры, охват и реакции по каждой публикации собираются сами.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="quality">
        <div className="grid">
          <div className="z-basic">
            <h2>Качество и безопасность</h2>
            <div className="tiles tiles--3" style={{ marginTop: "var(--sp-md)" }}>
              <div className="tile">
                <span className="tile__num">Качество</span>
                <h3>Перекодируем только когда без этого нельзя.</h3>
                <p className="muted">
                  YouTube получает оригинал байт в байт. Для остальных сетей видео
                  переупаковывается без пережатия, а если сеть требует, кодируется ровно
                  по её спецификации.
                </p>
              </div>
              <div className="tile">
                <span className="tile__num">Доступы</span>
                <h3>Только официальные API.</h3>
                <p className="muted">
                  Пароли от соцсетей не вводятся. Доступы хранятся зашифрованными
                  (AES-256-GCM) и отзываются у площадки при отключении.
                </p>
              </div>
              <div className="tile">
                <span className="tile__num">Вход</span>
                <h3>Закрытый сервис для своих.</h3>
                <p className="muted">
                  Войти могут только приглашённые. Вход по ссылке на почту или по паролю.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
