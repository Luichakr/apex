/**
 * Статистика публикаций прямо из соцсетей: последние посты каждой сети с цифрами.
 * Только чтение, официальные API. Что сеть не отдаёт — честно помечаем и берём
 * из того, что опубликовано через сам APX.
 *
 * Запросов к сети немало (у Instagram — по одному на пост за охватами и ещё по
 * одному за комментариями), поэтому ответ кэшируется на CACHE_SEC. Кнопка
 * «Обновить» сбрасывает кэш, но не чаще раза в минуту.
 */
import type { Provider } from "@prisma/client";
import { prisma } from "./db";
import { connection } from "./redis";
import { getDecryptedAccount } from "./accounts";
import { getProvider } from "./providers";
import type { DecryptedAccount } from "./providers/types";
import { demoHistory, isDemo } from "./demo";

export type HistoryItem = {
  id: string;
  title: string;
  url?: string;
  thumb?: string;
  publishedAt?: string; // ISO
  views?: number;
  likes?: number;
  comments?: number;
  /** Веток комментариев, где владелец ещё не ответил (считаем до 100 веток). */
  unanswered?: number;
  shares?: number;
  reach?: number;
  saves?: number;
  durationSec?: number;
  kind?: string;
  /** Среднее время просмотра, секунды. */
  avgWatchSec?: number;
  /** Досмотр: доля ролика, которую в среднем смотрят, в процентах (YouTube). */
  retentionPct?: number;
  /** Подписались после этого видео. */
  follows?: number;
  /** Перешли в профиль с этого видео (Instagram). */
  profileVisits?: number;
};

export type NetworkHistory = {
  provider: Provider;
  account: string;
  source: "network" | "apex" | "none";
  items: HistoryItem[];
  note?: string;
  fetchedAt: string;
};

const LIMIT = 30;
const CACHE_SEC = 30 * 60;
const FORCE_GAP_SEC = 60;

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const firstLine = (s: string | undefined | null, max = 160) =>
  (s ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, max) || "Без текста";

/** «PT1M5S» → 65 секунд. */
function isoDuration(d?: string): number | undefined {
  const m = d?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : undefined;
}

/** Выполнить задачи не более чем по N одновременно. */
async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

// --- YouTube -----------------------------------------------------------------

async function youtubeRecent(acc: DecryptedAccount): Promise<HistoryItem[]> {
  const auth = { Authorization: `Bearer ${acc.accessToken}` };
  const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", {
    headers: auth,
    cache: "no-store",
  });
  if (!ch.ok) throw new Error(`YouTube: HTTP ${ch.status}`);
  const chJson = await ch.json();
  const channelId: string | undefined = chJson.items?.[0]?.id;
  const uploads = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined;
  if (!uploads) return [];
  const pl = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${LIMIT}&playlistId=${uploads}`,
    { headers: auth, cache: "no-store" }
  );
  if (!pl.ok) throw new Error(`YouTube: HTTP ${pl.status}`);
  const ids = ((await pl.json()).items ?? []).map((i: { contentDetails: { videoId: string } }) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const vs = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`,
    { headers: auth, cache: "no-store" }
  );
  if (!vs.ok) throw new Error(`YouTube: HTTP ${vs.status}`);
  type V = {
    id: string;
    snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    statistics?: Record<string, string>;
    contentDetails?: { duration?: string };
  };
  const videos = (await vs.json()).items as V[];

  // Неотвеченные ветки: владелец ответил, если среди ответов есть его канал.
  const unanswered = await pooled(videos, 4, async (v) => {
    if (!num(v.statistics?.commentCount)) return 0;
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&maxResults=100&videoId=${v.id}`,
      { headers: auth, cache: "no-store" }
    ).catch(() => null);
    if (!r || !r.ok) return undefined;
    type T = {
      snippet: { topLevelComment: { snippet: { authorChannelId?: { value?: string } } } };
      replies?: { comments?: { snippet: { authorChannelId?: { value?: string } } }[] };
    };
    const threads = ((await r.json().catch(() => ({}))).items ?? []) as T[];
    return threads.filter((t) => {
      const mine = t.snippet.topLevelComment.snippet.authorChannelId?.value === channelId;
      const replied = t.replies?.comments?.some((c) => c.snippet.authorChannelId?.value === channelId);
      return !mine && !replied;
    }).length;
  });

  // YouTube Analytics: один запрос на все видео. Если API не включён в Google
  // Cloud или права нет — просто без этих колонок.
  const analytics = new Map<string, { avg: number; pct: number; subs: number; shares: number }>();
  try {
    const q = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    q.searchParams.set("ids", "channel==MINE");
    q.searchParams.set("startDate", "2010-01-01");
    q.searchParams.set("endDate", new Date().toISOString().slice(0, 10));
    q.searchParams.set("metrics", "averageViewDuration,averageViewPercentage,subscribersGained,shares");
    q.searchParams.set("dimensions", "video");
    q.searchParams.set("filters", `video==${ids.join(",")}`);
    const r = await fetch(q, { headers: auth, cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { rows?: (string | number)[][] };
      for (const row of j.rows ?? []) {
        analytics.set(String(row[0]), { avg: Number(row[1]), pct: Number(row[2]), subs: Number(row[3]), shares: Number(row[4]) });
      }
    }
  } catch {
    /* необязательно */
  }

  return videos.map((v, i) => ({
    id: v.id,
    title: v.snippet.title,
    url: `https://youtu.be/${v.id}`,
    thumb: (v.snippet.thumbnails?.medium ?? v.snippet.thumbnails?.default)?.url,
    publishedAt: v.snippet.publishedAt,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    unanswered: unanswered[i],
    durationSec: isoDuration(v.contentDetails?.duration),
    shares: analytics.get(v.id)?.shares,
    avgWatchSec: analytics.has(v.id) ? Math.round(analytics.get(v.id)!.avg * 10) / 10 : undefined,
    retentionPct: analytics.has(v.id) ? Math.round(analytics.get(v.id)!.pct * 10) / 10 : undefined,
    follows: analytics.get(v.id)?.subs,
  }));
}

// --- Instagram ---------------------------------------------------------------

const IG = "https://graph.instagram.com/v21.0";

async function instagramRecent(acc: DecryptedAccount): Promise<HistoryItem[]> {
  const url = new URL(`${IG}/me/media`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count"
  );
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("access_token", acc.accessToken);
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Instagram: ${json.error?.message ?? `HTTP ${res.status}`}`);
  type M = {
    id: string; caption?: string; media_product_type?: string; media_type?: string; permalink?: string;
    thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number;
  };
  const items = (json.data as M[]).slice(0, LIMIT);
  const igUserId = String(acc.meta?.igUserId ?? acc.providerAccountId);

  const extra = await pooled(items, 4, async (m) => {
    // Охваты и просмотры — отдельным запросом; без права insights просто пропускаем.
    const by = new Map<string, number>();
    const collect = async (metric: string) => {
      const q = new URL(`${IG}/${m.id}/insights`);
      q.searchParams.set("metric", metric);
      q.searchParams.set("access_token", acc.accessToken);
      const r = await fetch(q, { cache: "no-store" }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      for (const row of (j?.data ?? []) as { name?: string; values?: { value?: number }[] }[]) {
        if (row.name && typeof row.values?.[0]?.value === "number") by.set(row.name, row.values[0].value);
      }
    };
    await collect("reach,views,shares,saved");
    // Время просмотра есть только у Reels; подписки и переходы — у всех. Если
    // сеть не знает метрику, она отвечает ошибкой на весь запрос — поэтому отдельно.
    if (m.media_product_type === "REELS") await collect("ig_reels_avg_watch_time,ig_reels_video_view_total_time");
    await collect("follows,profile_visits");
    // Неотвеченные: ветки, где нет нашего ответа. Нужно право manage_comments.
    let unanswered: number | undefined = m.comments_count ? undefined : 0;
    if (m.comments_count) {
      const c = new URL(`${IG}/${m.id}/comments`);
      c.searchParams.set("fields", "id,from,replies{from}");
      c.searchParams.set("limit", "100");
      c.searchParams.set("access_token", acc.accessToken);
      const cr = await fetch(c, { cache: "no-store" }).catch(() => null);
      const cj = cr ? await cr.json().catch(() => null) : null;
      type C = { from?: { id?: string }; replies?: { data?: { from?: { id?: string } }[] } };
      const list = cj?.data as C[] | undefined;
      if (list) {
        unanswered = list.filter(
          (t) => t.from?.id !== igUserId && !t.replies?.data?.some((r) => r.from?.id === igUserId)
        ).length;
      }
    }
    return { by, unanswered };
  });

  return items.map((m, i) => ({
    id: m.id,
    title: firstLine(m.caption),
    url: m.permalink,
    thumb: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url : undefined),
    publishedAt: m.timestamp,
    likes: m.like_count,
    comments: m.comments_count,
    unanswered: extra[i].unanswered,
    views: extra[i].by.get("views"),
    reach: extra[i].by.get("reach"),
    shares: extra[i].by.get("shares"),
    saves: extra[i].by.get("saved"),
    avgWatchSec: extra[i].by.has("ig_reels_avg_watch_time") ? Math.round(extra[i].by.get("ig_reels_avg_watch_time")! / 100) / 10 : undefined,
    follows: extra[i].by.get("follows"),
    profileVisits: extra[i].by.get("profile_visits"),
    kind: m.media_product_type,
  }));
}

const NETWORK_READERS: Partial<Record<Provider, (a: DecryptedAccount) => Promise<HistoryItem[]>>> = {
  YOUTUBE: youtubeRecent,
  INSTAGRAM: instagramRecent,
};

const NO_READ_NOTE: Partial<Record<Provider, string>> = {
  TIKTOK: "TikTok отдаёт список видео только после аудита приложения. Здесь — то, что опубликовано через APX.",
  LINKEDIN: "LinkedIn не даёт читать ленту обычным приложениям. Здесь — то, что опубликовано через APX.",
  TELEGRAM: "Бот Telegram не может читать историю канала. Здесь — то, что опубликовано через APX.",
  FACEBOOK: "Здесь — то, что опубликовано через APX.",
};

async function apexRecent(userId: string, provider: Provider): Promise<HistoryItem[]> {
  const targets = await prisma.postTarget.findMany({
    where: { status: "DONE", provider, post: { userId } },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    include: { post: { select: { caption: true } }, metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });
  return targets.map((t) => {
    const m = t.metrics[0];
    return {
      id: t.id,
      title: firstLine(t.captionOverride ?? t.post.caption),
      url: t.externalUrl ?? undefined,
      thumb: `/api/posts/${t.postId}/poster`,
      publishedAt: t.createdAt.toISOString(),
      views: m?.views ?? undefined,
      reach: m?.reach ?? undefined,
      likes: m?.likes ?? undefined,
      comments: m?.comments ?? undefined,
      shares: m?.shares ?? undefined,
      saves: m?.saves ?? undefined,
    };
  });
}

/** Статистика по всем подключённым сетям пользователя (с кэшем). */
export async function loadHistory(userId: string, force = false): Promise<NetworkHistory[]> {
  if (await isDemo()) return demoHistory();
  const accounts = await prisma.socialAccount.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  return Promise.all(
    accounts.map(async (a): Promise<NetworkHistory> => {
      const base = { provider: a.provider, account: a.displayName ?? a.providerAccountId };
      const key = `history:${a.id}`;
      const hit = await connection.get(key).catch(() => null);
      if (hit) {
        const cached = JSON.parse(hit) as NetworkHistory;
        // Принудительное обновление — не чаще раза в минуту, чтобы не выжечь лимиты.
        if (!force || Date.now() - new Date(cached.fetchedAt).getTime() < FORCE_GAP_SEC * 1000) return cached;
      }
      let result: NetworkHistory;
      const reader = NETWORK_READERS[a.provider];
      const fetchedAt = new Date().toISOString();
      if (reader && !a.needsReconnect) {
        try {
          let acc = (await getDecryptedAccount(a.id))!;
          const p = getProvider(a.provider);
          if (p?.ensureFreshToken) acc = await p.ensureFreshToken(acc);
          const items = await reader(acc);
          result = { ...base, source: "network", items, fetchedAt };
          if (a.provider === "INSTAGRAM" && items.length && items.every((i) => i.reach === undefined)) {
            result.note =
              "Просмотры и охват не пришли: у аккаунта нет права на статистику. Переподключите Instagram на странице «Аккаунты».";
          }
        } catch (e) {
          result = {
            ...base,
            source: "none",
            items: await apexRecent(userId, a.provider),
            note: `Не удалось получить данные: ${e instanceof Error ? e.message : "ошибка"}`,
            fetchedAt,
          };
        }
      } else {
        result = {
          ...base,
          source: "apex",
          items: await apexRecent(userId, a.provider),
          note: a.needsReconnect ? "Доступ отозван — переподключите аккаунт." : NO_READ_NOTE[a.provider],
          fetchedAt,
        };
      }
      await connection.set(key, JSON.stringify(result), "EX", CACHE_SEC).catch(() => {});
      return result;
    })
  );
}

// --- Периоды и итоги -----------------------------------------------------------

export type PeriodKey = "day" | "week" | "month" | "year" | "custom";
export type Period = { key: PeriodKey; from: Date; to: Date; label: string };

const TZ = "Europe/Kyiv";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
/** Полночь указанного дня в Киеве как момент UTC. */
function kyivMidnight(ymd: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return new Date(guess.getTime() - h * 3600_000);
}
const fmtD = (d: Date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(d);

/** Разбор периода из строки запроса. По умолчанию — месяц. */
export function parsePeriod(q: { p?: string; from?: string; to?: string }): Period {
  const now = new Date();
  const todayStart = kyivMidnight(dayKey(now));
  const dayMs = 86_400_000;
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  if (q.p === "custom" && ok(q.from) && ok(q.to)) {
    const from = kyivMidnight(q.from!);
    const to = new Date(kyivMidnight(q.to!).getTime() + dayMs);
    if (from < to) return { key: "custom", from, to, label: `${fmtD(from)} — ${fmtD(new Date(to.getTime() - 1))}` };
  }
  switch (q.p) {
    case "day":
      return { key: "day", from: todayStart, to: now, label: "Сегодня" };
    case "week":
      return { key: "week", from: new Date(todayStart.getTime() - 6 * dayMs), to: now, label: "7 дней" };
    case "year":
      return { key: "year", from: new Date(todayStart.getTime() - 364 * dayMs), to: now, label: "Год" };
    default:
      return { key: "month", from: new Date(todayStart.getTime() - 29 * dayMs), to: now, label: "30 дней" };
  }
}

export function inPeriod(i: HistoryItem, p: Period): boolean {
  if (!i.publishedAt) return false;
  const t = new Date(i.publishedAt).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
}

export type Totals = {
  posts: number;
  views: number; reach: number; likes: number; comments: number; shares: number; saves: number;
  unanswered: number;
  hasViews: boolean; hasReach: boolean; hasShares: boolean; hasSaves: boolean; hasUnanswered: boolean;
};

export function totals(items: HistoryItem[]): Totals {
  const t: Totals = {
    posts: items.length, views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, unanswered: 0,
    hasViews: false, hasReach: false, hasShares: false, hasSaves: false, hasUnanswered: false,
  };
  for (const i of items) {
    if (i.views !== undefined) { t.views += i.views; t.hasViews = true; }
    if (i.reach !== undefined) { t.reach += i.reach; t.hasReach = true; }
    if (i.shares !== undefined) { t.shares += i.shares; t.hasShares = true; }
    if (i.saves !== undefined) { t.saves += i.saves; t.hasSaves = true; }
    if (i.unanswered !== undefined) { t.unanswered += i.unanswered; t.hasUnanswered = true; }
    t.likes += i.likes ?? 0;
    t.comments += i.comments ?? 0;
  }
  return t;
}

/** Вовлечённость: реакции к просмотрам (или охвату), в процентах. */
export function engagementRate(i: Pick<HistoryItem, "views" | "reach" | "likes" | "comments" | "shares" | "saves">): number | null {
  const base = i.views ?? i.reach;
  if (!base) return null;
  return (((i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0) + (i.saves ?? 0)) / base) * 100;
}
