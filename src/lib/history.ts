/**
 * История публикаций прямо из соцсетей: последние посты каждой сети со статистикой.
 * Только чтение, официальные API. Что сеть не отдаёт — честно помечаем и берём
 * из того, что опубликовано через сам APEX.
 */
import type { Provider } from "@prisma/client";
import { prisma } from "./db";
import { connection } from "./redis";
import { getDecryptedAccount } from "./accounts";
import { getProvider } from "./providers";
import type { DecryptedAccount } from "./providers/types";

export type HistoryItem = {
  id: string;
  title: string;
  url?: string;
  thumb?: string;
  publishedAt?: string; // ISO
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
  kind?: string;
};

export type NetworkHistory = {
  provider: Provider;
  account: string;
  source: "network" | "apex" | "none";
  items: HistoryItem[];
  note?: string;
};

const LIMIT = 5;
const CACHE_SEC = 300;
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const firstLine = (s: string | undefined | null, max = 160) =>
  (s ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, max) || "Без текста";

async function youtubeRecent(acc: DecryptedAccount): Promise<HistoryItem[]> {
  const auth = { Authorization: `Bearer ${acc.accessToken}` };
  const ch = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
    { headers: auth, cache: "no-store" }
  );
  if (!ch.ok) throw new Error(`YouTube: HTTP ${ch.status}`);
  const uploads = (await ch.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined;
  if (!uploads) return [];
  const pl = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${LIMIT}&playlistId=${uploads}`,
    { headers: auth, cache: "no-store" }
  );
  if (!pl.ok) throw new Error(`YouTube: HTTP ${pl.status}`);
  const ids = ((await pl.json()).items ?? []).map((i: { contentDetails: { videoId: string } }) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const vs = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}`,
    { headers: auth, cache: "no-store" }
  );
  if (!vs.ok) throw new Error(`YouTube: HTTP ${vs.status}`);
  type V = { id: string; snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> }; statistics?: Record<string, string> };
  return ((await vs.json()).items as V[]).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    url: `https://youtu.be/${v.id}`,
    thumb: (v.snippet.thumbnails?.medium ?? v.snippet.thumbnails?.default)?.url,
    publishedAt: v.snippet.publishedAt,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
  }));
}

async function instagramRecent(acc: DecryptedAccount): Promise<HistoryItem[]> {
  const url = new URL("https://graph.instagram.com/v21.0/me/media");
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count"
  );
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("access_token", acc.accessToken);
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Instagram: ${json.error?.message ?? `HTTP ${res.status}`}`);
  type M = { id: string; caption?: string; media_product_type?: string; media_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number };
  const items = (json.data as M[]).slice(0, LIMIT);
  // Охваты — отдельным запросом на каждый пост; без права insights просто пропускаем.
  const stats = await Promise.all(
    items.map(async (m) => {
      const u = new URL(`https://graph.instagram.com/v21.0/${m.id}/insights`);
      u.searchParams.set("metric", "reach,views,shares,saved");
      u.searchParams.set("access_token", acc.accessToken);
      const r = await fetch(u, { cache: "no-store" }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      const by = new Map<string, number>();
      for (const row of (j?.data ?? []) as { name?: string; values?: { value?: number }[] }[]) {
        if (row.name && typeof row.values?.[0]?.value === "number") by.set(row.name, row.values[0].value);
      }
      return by;
    })
  );
  return items.map((m, idx) => ({
    id: m.id,
    title: firstLine(m.caption),
    url: m.permalink,
    thumb: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url : undefined),
    publishedAt: m.timestamp,
    likes: m.like_count,
    comments: m.comments_count,
    views: stats[idx].get("views"),
    reach: stats[idx].get("reach"),
    shares: stats[idx].get("shares"),
    kind: m.media_product_type,
  }));
}

const NETWORK_READERS: Partial<Record<Provider, (a: DecryptedAccount) => Promise<HistoryItem[]>>> = {
  YOUTUBE: youtubeRecent,
  INSTAGRAM: instagramRecent,
};

const NO_READ_NOTE: Partial<Record<Provider, string>> = {
  TIKTOK: "TikTok отдаёт список видео только с правом video.list (нужен аудит приложения). Ниже — то, что опубликовано через APEX.",
  LINKEDIN: "LinkedIn не даёт читать ленту обычным приложениям (право r_member_social закрыто). Ниже — то, что опубликовано через APEX.",
  TELEGRAM: "Бот Telegram не может читать историю канала. Ниже — то, что опубликовано через APEX.",
  FACEBOOK: "Ниже — то, что опубликовано через APEX.",
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
    };
  });
}

/** История по всем подключённым сетям пользователя (с кэшем на 5 минут). */
export async function loadHistory(userId: string, force = false): Promise<NetworkHistory[]> {
  const accounts = await prisma.socialAccount.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  return Promise.all(
    accounts.map(async (a): Promise<NetworkHistory> => {
      const base = { provider: a.provider, account: a.displayName ?? a.providerAccountId };
      const key = `history:${a.id}`;
      if (!force) {
        const hit = await connection.get(key).catch(() => null);
        if (hit) return JSON.parse(hit) as NetworkHistory;
      }
      let result: NetworkHistory;
      const reader = NETWORK_READERS[a.provider];
      if (reader && !a.needsReconnect) {
        try {
          let acc = (await getDecryptedAccount(a.id))!;
          const p = getProvider(a.provider);
          if (p?.ensureFreshToken) acc = await p.ensureFreshToken(acc);
          const items = await reader(acc);
          result = { ...base, source: "network", items };
          if (a.provider === "INSTAGRAM" && items.length && items.every((i) => i.reach === undefined)) {
            result.note =
              "Охваты и просмотры не пришли: у аккаунта нет права на статистику. Переподключите Instagram на странице «Аккаунты» и разрешите доступ к статистике.";
          }
        } catch (e) {
          result = {
            ...base,
            source: "none",
            items: await apexRecent(userId, a.provider),
            note: `Не удалось получить данные: ${e instanceof Error ? e.message : "ошибка"}`,
          };
        }
      } else {
        const items = await apexRecent(userId, a.provider);
        result = {
          ...base,
          source: "apex",
          items,
          note: a.needsReconnect
            ? "Доступ отозван — переподключите аккаунт."
            : NO_READ_NOTE[a.provider],
        };
      }
      await connection.set(key, JSON.stringify(result), "EX", CACHE_SEC).catch(() => {});
      return result;
    })
  );
}
