import Link from "next/link";
import Icon from "@/components/Icon";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser().catch(() => null);
  return (
    <main>
      <section className="grid hero">
        <div className="z-basic">
          <p className="eyebrow">Кросс-постинг видео</p>
          <h1 className="display hero__title" style={{ marginTop: 12 }}>
            Одно видео. Три сети. Без потери качества.
          </h1>
          <p className="lead hero__lead">
            Загрузите ролик один раз — APEX подготовит отдельную версию под
            требования YouTube Shorts, Instagram Reels и TikTok и опубликует её
            через официальные API.
          </p>
          <div className="row hero__cta">
            {user ? (
              <Link href="/compose" className="btn btn--stretch-sm">
                <Icon name="plus" /> Новый пост
              </Link>
            ) : (
              <Link href="/login" className="btn btn--stretch-sm">
                Войти
              </Link>
            )}
            <a href="#quality" className="link-arrow">
              <Icon name="arrow" /> Как сохраняется качество
            </a>
          </div>
        </div>
      </section>

      <section className="band section" id="flow">
        <div className="grid">
          <div className="z-basic">
            <h2>Как это работает.</h2>
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
                <p>Сразу или по расписанию. Повторы при сбое безопасны — без дублей.</p>
              </div>
              <div className="flow__item">
                <span className="meta">04</span>
                <h3>Статус</h3>
                <p>Ссылка на каждый пост, понятная причина, если сеть что-то отклонила.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="quality">
        <div className="grid">
          <div className="z-basic">
            <h2>Качество — главное.</h2>
            <p className="lead" style={{ marginTop: "var(--sp-sm)" }}>
              Каждая перекодировка — это потеря. Поэтому мы перекодируем только тогда,
              когда сеть иначе видео не примет, и ровно настолько, насколько требует её
              спецификация.
            </p>
            <div className="tiles tiles--3" style={{ marginTop: "var(--sp-md)" }}>
              <div className="tile">
                <span className="tile__num">YouTube Shorts</span>
                <h3>Оригинал без изменений.</h3>
                <p className="muted">
                  YouTube принимает HEVC, HDR и 4K и сам строит лучшие версии. Файл уходит
                  байт в байт, загрузка докачивается при обрыве связи.
                </p>
              </div>
              <div className="tile">
                <span className="tile__num">TikTok</span>
                <h3>Перепаковка без пережатия.</h3>
                <p className="muted">
                  Если кодек и частота подходят — видео не перекодируется вовсе. Иначе H.264
                  в исходном разрешении до 4K, HDR корректно переводится в SDR.
                </p>
              </div>
              <div className="tile">
                <span className="tile__num">Instagram Reels</span>
                <h3>Точно по спецификации.</h3>
                <p className="muted">
                  1080 по короткой стороне, до 24 Мбит/с, 23–60 fps, AAC 48 кГц — ровно то,
                  что Instagram показывает, чтобы его собственное сжатие не съело детали.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="grid">
          <div className="z-basic">
            <h2>Безопасность.</h2>
            <dl className="spec" style={{ marginTop: "var(--sp-md)" }}>
              <div>
                <dt>Вход</dt>
                <dd>По одноразовой ссылке, без паролей</dd>
              </div>
              <div>
                <dt>Доступы к сетям</dt>
                <dd>AES-256-GCM, привязка к владельцу</dd>
              </div>
              <div>
                <dt>Публикация</dt>
                <dd>Только официальные API площадок</dd>
              </div>
              <div>
                <dt>Отключение</dt>
                <dd>Токен удаляется и отзывается у площадки</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </main>
  );
}
