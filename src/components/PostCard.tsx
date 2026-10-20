import type { Post, PostTarget } from "@prisma/client";
import Icon from "./Icon";
import CopyButton from "./CopyButton";
import ConfirmSubmit from "./ConfirmSubmit";
import { PROVIDER_LABEL } from "@/lib/limits";
import type { MediaInfo, RenditionMeta } from "@/lib/video";

type PostWithTargets = Post & { targets: PostTarget[] };

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

function TargetStatus({ t, post, canEdit }: { t: PostTarget; post: PostWithTargets; canEdit: boolean }) {
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
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
