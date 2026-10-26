import type { Post, PostMetric, PostTarget } from "@prisma/client";
import Icon from "./Icon";
import CopyButton from "./CopyButton";
import ConfirmSubmit from "./ConfirmSubmit";
import { PROVIDER_LABEL } from "@/lib/limits";
import type { MediaInfo, RenditionMeta } from "@/lib/video";

type TargetWithMetrics = PostTarget & { metrics?: PostMetric[] };
type PostWithTargets = Post & { targets: TargetWithMetrics[] };

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(d);

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} МБ`;
}

const CODEC: Record<string, string> = { h264: "H.264", hevc: "HEVC", vp9: "VP9", vp8: "VP8", av1: "AV1", prores: "ProRes" };
const codecName = (c?: string) => (c ? CODEC[c] ?? c.toUpperCase() : undefined);

/** «1080×1920 · 59.97 fps · HEVC · HDR · 0:15 · 23 МБ» */
export function sourceLine(meta: unknown): string | null {
  const m = meta as MediaInfo | null;
  const v = m?.video;
  if (!m || !v) return null;
  return [
    `${v.displayWidth}×${v.displayHeight}`,
    `${Math.round(v.fps * 100) / 100} fps`,
    codecName(v.codec),
    v.hdr ? (v.dolbyVision ? "Dolby Vision" : "HDR") : null,
    v.bitDepth > 8 ? `${v.bitDepth} бит` : null,
    fmtDuration(m.duration),
    fmtBytes(m.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

function renditionLine(meta: unknown): string | null {
  const r = meta as RenditionMeta | null;
  if (!r) return null;
  const what =
    r.kind === "original"
      ? "оригинал без изменений"
      : r.kind === "remux"
        ? "без перекодирования"
        : r.reason.replace(/^перекодирование: /, "перекодировано: ");
  return [
    r.width && r.height ? `${r.width}×${r.height}` : null,
    r.fps ? `${r.fps} fps` : null,
    codecName(r.videoCodec),
    r.videoKbps ? `${(r.videoKbps / 1000).toFixed(1)} Мбит/с` : null,
    what,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Короткое представление большого числа: 12_345 → «12.3k». */
function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
}

/** «15 мин назад», «2 ч назад», «вчера» — для подписи «обновлено …». */
function fmtRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.round(h / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return fmtDate(d);
}

/** Строка со свежими охватами публикации. */
function MetricsLine({ t }: { t: TargetWithMetrics }) {
  if (t.status !== "DONE" || t.isDraft) return null;
  const last = t.metrics?.[0];
  // Telegram и TikTok метрики не отдают — честно говорим об этом.
  if (!last) {
    if (t.provider === "TELEGRAM" || t.provider === "TIKTOK") {
      return <p className="target__detail" style={{ marginTop: 4 }}>Охваты для этой сети недоступны по API.</p>;
    }
    if (t.metricsError) {
      return <p className="target__detail" style={{ marginTop: 4 }}>Охваты пока не получены: {t.metricsError}</p>;
    }
    return <p className="target__detail" style={{ marginTop: 4 }}>Охваты появятся после ближайшего опроса (раз в 6 ч).</p>;
  }
  const parts: string[] = [];
  const headline = last.views ?? last.reach;
  if (headline !== null && headline !== undefined) {
    parts.push(`${last.reach !== null && last.reach !== undefined ? "охват" : "просмотры"} ${fmtNum(headline)}`);
  }
  if (last.likes !== null && last.likes !== undefined) parts.push(`❤ ${fmtNum(last.likes)}`);
  if (last.comments !== null && last.comments !== undefined) parts.push(`💬 ${fmtNum(last.comments)}`);
  if (last.shares !== null && last.shares !== undefined) parts.push(`↗ ${fmtNum(last.shares)}`);
  if (last.saves !== null && last.saves !== undefined) parts.push(`🔖 ${fmtNum(last.saves)}`);
  if (parts.length === 0) {
    return <p className="target__detail" style={{ marginTop: 4 }}>Площадка ещё не отдала показатели.</p>;
  }
  return (
    <p className="target__detail" style={{ marginTop: 4 }}>
      {parts.join(" · ")} <span className="muted">· обновлено {fmtRelative(last.fetchedAt)}</span>
    </p>
  );
}

function TargetStatus({ t, post, canEdit }: { t: TargetWithMetrics; post: PostWithTargets; canEdit: boolean }) {
  const caption = t.captionOverride ?? post.caption;
  if (t.status === "DONE") {
    if (t.isDraft && t.provider === "TIKTOK") {
      return (
        <div className="target">
          <div className="target__head">
            <span className="target__name">{PROVIDER_LABEL[t.provider]}</span>
            <span className="tag tag--live"><Icon name="inbox" /> Во входящих TikTok</span>
          </div>
          <p className="target__detail">
            Откройте TikTok → уведомление «Видео готово» → вставьте текст и нажмите «Опубликовать».
          </p>
          {caption && <CopyButton text={caption} label="Скопировать текст для TikTok" />}
        </div>
      );
    }
    return (
      <div className="target">
        <div className="target__head">
          <span className="target__name">{PROVIDER_LABEL[t.provider]}</span>
          <span className="row" style={{ gap: 10 }}>
            <span className="tag tag--ok"><Icon name="check" /> Опубликовано</span>
            {t.externalUrl && (
              <a href={t.externalUrl} target="_blank" rel="noreferrer" className="link-arrow small">
                <Icon name="external" /> Открыть
              </a>
            )}
          </span>
        </div>
        {t.error && <p className="target__detail">{t.error}</p>}
      </div>
    );
  }

  if (t.status === "FAILED") {
    return (
      <div className="target">
        <div className="target__head">
          <span className="target__name">{PROVIDER_LABEL[t.provider]}</span>
          <span className="row" style={{ gap: 10 }}>
            <span className="tag tag--error"><Icon name="alert" /> Ошибка</span>
            {canEdit && t.socialAccountId && !post.mediaDeletedAt && (
              <form action={`/api/targets/${t.id}/retry`} method="post">
                <button type="submit" className="btn btn--tool btn--sm">
                  <Icon name="refresh" /> Повторить
                </button>
              </form>
            )}
          </span>
        </div>
        {t.error && <p className="target__error">{t.error}</p>}
      </div>
    );
  }

  // В работе
  const scheduled = post.status === "SCHEDULED" && post.scheduledAt;
  let label = scheduled ? `Запланировано на ${fmtDate(post.scheduledAt!)}` : "В очереди";
  let pct: number | null = null;
  if (t.status === "PROCESSING") {
    if (t.stage === "prepare") {
      label = `Готовим версию для ${PROVIDER_LABEL[t.provider]}`;
      pct = t.progress ?? 0;
    } else if (t.stage === "processing") {
      label = `${PROVIDER_LABEL[t.provider]} обрабатывает видео`;
    } else {
      label = `Загружаем в ${PROVIDER_LABEL[t.provider]}`;
    }
  } else if (t.stage === "retry") {
    label = "Повторим попытку";
  }
  return (
    <div className="target">
      <div className="target__head">
        <span className="target__name">{PROVIDER_LABEL[t.provider]}</span>
        <span className={`tag ${scheduled ? "" : "tag--live"}`}>
          {scheduled ? <Icon name="clock" /> : <span className="spinner" />}
          {label}
          {pct !== null && pct > 0 ? ` · ${pct}%` : ""}
        </span>
      </div>
      {!scheduled && (
        <div className={`bar ${pct === null || pct === 0 ? "bar--indet" : ""}`} aria-hidden>
          <div className="bar__fill" style={pct ? { width: `${pct}%` } : undefined} />
        </div>
      )}
      {t.stage === "retry" && t.error && <p className="target__detail">{t.error}</p>}
    </div>
  );
}

export default function PostCard({ post, canEdit = true }: { post: PostWithTargets; canEdit?: boolean }) {
  const vertical =
    (post.mediaMeta as MediaInfo | null)?.video
      ? (post.mediaMeta as MediaInfo).video!.displayHeight >= (post.mediaMeta as MediaInfo).video!.displayWidth
      : true;
  const src = sourceLine(post.mediaMeta);
  return (
    <article className="post">
      <div className="post__media">
        {post.mediaDeletedAt ? (
          <div className={`poster ${vertical ? "" : "poster--wide"}`}>
            <Icon name="film" />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={`poster ${vertical ? "" : "poster--wide"}`}
            src={`/api/posts/${post.id}/poster`}
            alt=""
            loading="lazy"
          />
        )}
      </div>
      <div className="stack-sm" style={{ minWidth: 0 }}>
        <div className="between">
          <span className="meta">{fmtDate(post.createdAt)}</span>
          <span className="row" style={{ gap: 10 }}>
            {post.status === "PARTIAL" && <span className="tag tag--warn">Частично</span>}
            {canEdit && !post.targets.some((t) => t.status === "PROCESSING") && (
              <form action={`/api/posts/${post.id}/delete`} method="post">
                {post.status === "SCHEDULED" ? (
                  <ConfirmSubmit className="btn btn--tool btn--sm" question="Отменить запланированную публикацию? Видео будет удалено из APEX.">
                    Отменить
                  </ConfirmSubmit>
                ) : (
                  <ConfirmSubmit className="btn btn--tool btn--sm" question="Убрать пост из APEX? Уже опубликованное в сетях останется — удалять его нужно в самих приложениях.">
                    Удалить
                  </ConfirmSubmit>
                )}
              </form>
            )}
          </span>
        </div>
        <p className="post__caption">{post.caption || <span className="muted">Без текста</span>}</p>
        {src && <p className="meta">Исходник: {src}</p>}
        <ul className="rows" style={{ marginTop: 8 }}>
          {post.targets.map((t) => (
            <li key={t.id}>
              <TargetStatus t={t} post={post} canEdit={canEdit} />
              {renditionLine(t.renditionMeta) && (
                <p className="target__detail" style={{ marginTop: 6 }}>
                  Ушло в сеть: {renditionLine(t.renditionMeta)}
                </p>
              )}
              <MetricsLine t={t} />
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
