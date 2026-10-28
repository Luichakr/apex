/**
 * Демо-режим: вымышленные данные «как будто APX работает полгода».
 * Включается cookie apx_demo=1 (кнопка в меню). Ничего не пишет в базу и не
 * ходит в сети — только подменяет то, что страницы читают.
 * Генератор детерминированный: цифры одинаковые при каждом открытии.
 */
import { cookies } from "next/headers";
import type { Post, PostMetric, PostTarget, Provider, PostStatus, TargetStatus } from "@prisma/client";
import type { HistoryItem, NetworkHistory } from "./history";

export const DEMO_COOKIE = "apx_demo";

export async function isDemo(): Promise<boolean> {
  try {
    return (await cookies()).get(DEMO_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

// --- Генератор -----------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DAYS = 180;
const NOW = () => new Date();

const TITLES = [
  "Решил поработать над внешним видом Mercedes SL500 R230: колёсные проставки",
  "Признавайся, хотел бы посидеть?",
  "Не могу сказать, что мечтал, но попробовать всегда хотелось",
  "Владельцы электромобилей, зацените!",
  "А что выберете вы? Спорткары или современные электромобили?",
  "Как его зовут? Напомните мне, пожалуйста",
  "Мой любимый отдел автопрома",
  "ZEEKR: год назад о нём знали единицы, сегодня поляки ждут его в лизинг",
  "Люблю, когда везде есть свои люди",
  "Сыграем? Что за марка и модель на видео",
  "The Toyota Supra: но куда, зачем?",
  "Unboxing a $25 Starlink Mount",
  "NAS unboxing: личное облако для фото и видео",
  "OURA RING 4 unpacking",
  "BMW 750L G12 на больших колёсах",
  "Corvette C3 на ULTRACE 2026 Gdańsk",
  "Mercedes SL550 R230 ULTRACE 2026",
  "KAZUHIGE SAKAMOTO ULTRACE 2026",
  "ULTRACE 2026 Gdańsk: общий план",
  "Young timer Warszawa 98",
  "ul. Poznańska 98: рядом с Варшавой",
  "Тест-драйв: что не так с новыми китайцами",
  "Как поменять задние колодки за 20 минут",
  "Самый редкий салон W216 CL550 в мире",
  "TOP 6 STANCE Mercedes W126",
  "Химчистка салона Kia Rio: до и после",
  "BMW E34 STANCE: легенда за небольшие деньги",
  "Mercedes W126: лучший S-class за $3000",
  "Тотальный ремонт W220: часть 2",
  "Drift Fast II",
];

/** Разброс по сети: сколько в среднем смотрят, какие доли лайков и комментариев. */
const PROFILE: Record<Provider, { views: number; like: number; comment: number; share: number; save: number; reach: number }> = {
  YOUTUBE: { views: 1400, like: 0.035, comment: 0.004, share: 0, save: 0, reach: 0 },
  INSTAGRAM: { views: 2200, like: 0.045, comment: 0.006, share: 0.008, save: 0.012, reach: 0.78 },
  TIKTOK: { views: 5200, like: 0.06, comment: 0.005, share: 0.01, save: 0.008, reach: 0 },
  LINKEDIN: { views: 600, like: 0.03, comment: 0.008, share: 0.006, save: 0, reach: 0 },
  TELEGRAM: { views: 900, like: 0.02, comment: 0.003, share: 0.004, save: 0, reach: 0 },
  FACEBOOK: { views: 400, like: 0.02, comment: 0.003, share: 0.005, save: 0, reach: 0.6 },
};

export const DEMO_PROVIDERS: Provider[] = ["YOUTUBE", "INSTAGRAM", "TIKTOK", "TELEGRAM", "LINKEDIN"];
const DEMO_NAMES: Record<Provider, string> = {
  YOUTUBE: "THE LEE CHAN",
  INSTAGRAM: "@leechan_vlog",
  TIKTOK: "Lee Chan",
  TELEGRAM: "Истории @leechan",
  LINKEDIN: "Sergey Belskiy",
  FACEBOOK: "Lee Chan Auto",
};

type DemoPost = {
  idx: number;
  title: string;
  publishedAt: Date;
  providers: Provider[];
  status: PostStatus;
};

/** Около 60 постов за полгода, по 2–3 в неделю, с «пиками» на выходных. */
function demoPosts(): DemoPost[] {
  const r = rng(42);
  const out: DemoPost[] = [];
  const now = NOW().getTime();
  let t = now - DAYS * 86_400_000;
  let idx = 0;
  while (t < now - 3 * 3600_000) {
    const d = new Date(t);
    d.setHours(9 + Math.floor(r() * 12), Math.floor(r() * 60), 0, 0);
    const providers = DEMO_PROVIDERS.filter((p) => (p === "LINKEDIN" ? r() < 0.35 : p === "TELEGRAM" ? r() < 0.6 : r() < 0.9));
    if (providers.length === 0) providers.push("YOUTUBE", "INSTAGRAM");
    const roll = r();
    const status: PostStatus = roll < 0.03 ? "FAILED" : roll < 0.08 ? "PARTIAL" : "DONE";
    out.push({ idx, title: TITLES[idx % TITLES.length], publishedAt: d, providers, status });
    idx++;
    t += (2 + Math.floor(r() * 3)) * 86_400_000;
  }
  // Пара запланированных на ближайшие дни.
  for (let k = 1; k <= 2; k++) {
    const d = new Date(now + k * 2 * 86_400_000);
    d.setHours(18, 0, 0, 0);
    out.push({ idx: idx++, title: TITLES[(idx + 7) % TITLES.length], publishedAt: d, providers: ["YOUTUBE", "INSTAGRAM", "TIKTOK"], status: "SCHEDULED" });
  }
  return out;
}

function metricsFor(p: DemoPost, provider: Provider): HistoryItem {
  const r = rng(p.idx * 1000 + DEMO_PROVIDERS.indexOf(provider) + 7);
  const prof = PROFILE[provider];
  const ageDays = Math.max(0.2, (NOW().getTime() - p.publishedAt.getTime()) / 86_400_000);
  // Просмотры растут первые дни, потом почти стоят; есть «залётные» ролики.
  const viral = r() < 0.08 ? 4 + r() * 6 : 1;
  const base = prof.views * (0.4 + r() * 1.4) * viral * Math.min(1, 0.35 + Math.log1p(ageDays) / 3);
  const views = Math.round(base);
  const likes = Math.round(views * prof.like * (0.7 + r() * 0.6));
  const comments = Math.round(views * prof.comment * (0.5 + r()));
  const unanswered = comments ? Math.round(comments * (ageDays < 3 ? 0.6 : 0.15) * r()) : 0;
  return {
    id: `demo-${p.idx}-${provider}`,
    title: p.title,
    url: "#",
    thumb: `/api/demo/thumb?i=${p.idx}`,
    publishedAt: p.publishedAt.toISOString(),
    views,
    reach: prof.reach ? Math.round(views * prof.reach) : undefined,
    likes,
    comments,
    unanswered: provider === "YOUTUBE" || provider === "INSTAGRAM" ? unanswered : undefined,
    shares: prof.share ? Math.round(views * prof.share * r()) : undefined,
    saves: prof.save ? Math.round(views * prof.save * r()) : undefined,
    durationSec: provider === "YOUTUBE" ? 15 + Math.round(r() * 45) : undefined,
    kind: provider === "INSTAGRAM" ? "REELS" : undefined,
  };
}

/** Статистика по сетям, как её вернул бы loadHistory. */
export function demoHistory(): NetworkHistory[] {
  const posts = demoPosts().filter((p) => p.status !== "SCHEDULED" && p.status !== "FAILED");
  const fetchedAt = new Date(NOW().getTime() - 23 * 60_000).toISOString();
  return DEMO_PROVIDERS.map((provider) => ({
    provider,
    account: DEMO_NAMES[provider],
    source: provider === "YOUTUBE" || provider === "INSTAGRAM" ? "network" : "apex",
    items: posts
      .filter((p) => p.providers.includes(provider))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .map((p) => metricsFor(p, provider)),
    note: provider === "TIKTOK" || provider === "LINKEDIN" || provider === "TELEGRAM"
      ? "Сеть не отдаёт список публикаций по API. Здесь — то, что опубликовано через APX."
      : undefined,
    fetchedAt,
  }));
}

export type DemoAccount = {
  id: string;
  provider: Provider;
  displayName: string;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  needsReconnect: boolean;
  reconnectReason: string | null;
  refreshTokenEnc: string | null;
  meta: Record<string, unknown> | null;
};

export function demoAccounts(): DemoAccount[] {
  const created = new Date(NOW().getTime() - DAYS * 86_400_000);
  return DEMO_PROVIDERS.map((provider, i) => ({
    id: `demo-acc-${i}`,
    provider,
    displayName: DEMO_NAMES[provider],
    tokenExpiresAt: provider === "INSTAGRAM" ? new Date(NOW().getTime() + 41 * 86_400_000) : null,
    createdAt: created,
    needsReconnect: provider === "LINKEDIN",
    reconnectReason: provider === "LINKEDIN" ? "Срок доступа истёк — LinkedIn выдаёт его на 60 дней" : null,
    refreshTokenEnc: provider === "INSTAGRAM" ? null : "demo",
    meta: provider === "TELEGRAM" ? { kind: "story" } : provider === "YOUTUBE" ? { channelId: "demo" } : null,
  }));
}

export type DemoPostRow = Post & { targets: (PostTarget & { metrics: PostMetric[] })[] };

/** Посты в форме Prisma — для списка публикаций и календаря. */
export function demoPostRows(): DemoPostRow[] {
  const accs = demoAccounts();
  return demoPosts()
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((p) => {
      const id = `demo-${p.idx}`;
      const scheduled = p.status === "SCHEDULED";
      const targets = p.providers.map((provider, j): PostTarget & { metrics: PostMetric[] } => {
        const m = metricsFor(p, provider);
        const failedHere = p.status === "FAILED" || (p.status === "PARTIAL" && j === p.providers.length - 1);
        const status: TargetStatus = scheduled ? "QUEUED" : failedHere ? "FAILED" : "DONE";
        return {
          id: `${id}-${provider}`,
          postId: id,
          socialAccountId: accs.find((a) => a.provider === provider)?.id ?? null,
          provider,
          captionOverride: null,
          status,
          stage: null,
          progress: null,
          renditionMeta: provider === "YOUTUBE"
            ? { kind: "original", width: 1080, height: 1920, fps: 60, videoCodec: "hevc", videoKbps: 48000, reason: "" }
            : { kind: "remux", width: 1080, height: 1920, fps: 30, videoCodec: "h264", videoKbps: 18000, reason: "" },
          settings: null,
          coverMs: null,
          remoteId: null,
          isDraft: provider === "TIKTOK",
          externalId: status === "DONE" ? m.id : null,
          externalUrl: status === "DONE" ? "#" : null,
          error: failedHere ? (provider === "INSTAGRAM" ? "Instagram отклонил видео при обработке (ERROR)" : "YouTube: превышена дневная квота загрузок") : null,
          attempts: failedHere ? 3 : 1,
          metricsCheckedAt: status === "DONE" ? new Date(NOW().getTime() - 3 * 3600_000) : null,
          metricsError: null,
          createdAt: p.publishedAt,
          updatedAt: p.publishedAt,
          metrics: status === "DONE"
            ? [{
                id: `${id}-${provider}-m`,
                targetId: `${id}-${provider}`,
                fetchedAt: new Date(NOW().getTime() - 3 * 3600_000),
                views: m.views ?? null,
                reach: m.reach ?? null,
                likes: m.likes ?? null,
                comments: m.comments ?? null,
                shares: m.shares ?? null,
                saves: m.saves ?? null,
                raw: null,
              }]
            : [],
        };
      });
      return {
        id,
        userId: "demo",
        caption: p.title + "\n\n#auto #cars #leechan",
        mediaPath: "",
        mediaType: "video/mp4",
        mediaSize: null,
        mediaName: `IMG_${4000 + p.idx}.MOV`,
        mediaMeta: {
          duration: 24,
          sizeBytes: 48_000_000,
          video: { displayWidth: 1080, displayHeight: 1920, fps: 59.94, codec: "hevc", hdr: true, dolbyVision: false, bitDepth: 10 },
        },
        coverPath: null,
        mediaDeletedAt: p.publishedAt.getTime() < NOW().getTime() - 7 * 86_400_000 ? new Date(p.publishedAt.getTime() + 7 * 86_400_000) : null,
        status: p.status,
        scheduledAt: scheduled ? p.publishedAt : null,
        createdAt: p.publishedAt,
        updatedAt: p.publishedAt,
        targets,
      };
    });
}

/** Простая обложка-заглушка: градиент и номер. */
export function demoThumbSvg(i: number): string {
  const hues = [210, 25, 150, 280, 340, 45, 190, 0];
  const h = hues[i % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 55% 38%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 22%)"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/><circle cx="45" cy="80" r="18" fill="rgba(255,255,255,.18)"/><path d="M40 70l16 10-16 10z" fill="#fff"/></svg>`;
}
