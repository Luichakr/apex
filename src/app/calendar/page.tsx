import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { PostStatus } from "@prisma/client";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "@/components/Icon";
import { demoPostRows, isDemo } from "@/lib/demo";

export const metadata: Metadata = { title: "Календарь" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Kyiv";
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const STATUS: Record<PostStatus, { label: string; bg: string }> = {
  DRAFT: { label: "Черновик", bg: "var(--st-draft-bg)" },
  SCHEDULED: { label: "Запланировано", bg: "var(--st-scheduled-bg)" },
  PUBLISHING: { label: "Публикуется", bg: "var(--st-working-bg)" },
  DONE: { label: "Опубликовано", bg: "var(--st-published-bg)" },
  PARTIAL: { label: "Частично", bg: "var(--st-partial-bg)" },
  FAILED: { label: "Ошибка", bg: "var(--st-failed-bg)" },
};

/** Дата в часовом поясе владельца как «YYYY-MM-DD». */
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const timeOf = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

function parseMonth(m?: string): { y: number; mo: number } {
  const now = dayKey(new Date());
  const [y, mo] = (m && /^\d{4}-\d{2}$/.test(m) ? m : now.slice(0, 7)).split("-").map(Number);
  return { y, mo: Math.min(12, Math.max(1, mo)) };
}
const monthParam = (y: number, mo: number) => {
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { y, mo } = parseMonth((await searchParams).m);
  const ownerId = await dataOwnerId(user);

  // Берём с запасом в сутки по краям: границы месяца считаем в Киеве, а не в UTC.
  const from = new Date(Date.UTC(y, mo - 1, 1) - 86_400_000);
  const to = new Date(Date.UTC(y, mo, 1) + 86_400_000);
  const posts = (await isDemo())
    ? demoPostRows()
        .filter((p) => { const d = p.scheduledAt ?? p.createdAt; return d >= from && d < to; })
        .map((p) => ({ id: p.id, caption: p.caption, status: p.status, scheduledAt: p.scheduledAt, createdAt: p.createdAt, targets: p.targets.map((t) => ({ provider: t.provider })) }))
    : await prisma.post.findMany({
    where: {
      userId: ownerId,
      OR: [
        { scheduledAt: { gte: from, lt: to } },
        { scheduledAt: null, createdAt: { gte: from, lt: to } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, caption: true, status: true, scheduledAt: true, createdAt: true, targets: { select: { provider: true } } },
  });

  const byDay = new Map<string, typeof posts>();
  for (const p of posts) {
    const k = dayKey(p.scheduledAt ?? p.createdAt);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }

  const first = new Date(Date.UTC(y, mo - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // понедельник — первый день недели
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const today = dayKey(new Date());
  const title = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>Публикации</h1>
            <p className="lead">Что запланировано и что уже вышло, по дням. Время киевское.</p>
          </div>
          <nav className="tabs" aria-label="Вид">
            <Link href="/posts">Список</Link>
            <Link href="/calendar" aria-current="page">Календарь</Link>
          </nav>
        </div>
      </div>
      <div className="grid">
        <div className="z-basic stack">
          <div className="between">
            <Link className="btn btn--tool btn--sm" href={`/calendar?m=${monthParam(y, mo - 1)}`}>← Назад</Link>
            <h2 style={{ fontSize: "var(--fs-lg)" }}>{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
            <Link className="btn btn--tool btn--sm" href={`/calendar?m=${monthParam(y, mo + 1)}`}>Вперёд →</Link>
          </div>
          <div className="cal" role="table" aria-label={`Публикации, ${title}`}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal__wd" role="columnheader">{d}</div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} className="cal__day cal__day--empty" aria-hidden />;
              const k = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const list = byDay.get(k) ?? [];
              return (
                <div key={k} className={`cal__day ${k === today ? "cal__day--today" : ""}`} role="cell">
                  <span className="cal__num">{d}</span>
                  {list.map((p) => (
                    <Link
                      key={p.id}
                      href="/posts"
                      className="cal__post"
                      style={{ background: STATUS[p.status].bg }}
                      title={`${STATUS[p.status].label} · ${p.targets.map((t) => PROVIDER_LABEL[t.provider]).join(", ")}`}
                    >
                      <b>{timeOf(p.scheduledAt ?? p.createdAt)}</b> {p.caption.split("\n")[0] || "Без текста"}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="meta">
            {Object.values(STATUS).filter((s) => s.label !== "Черновик").map((s) => (
              <span key={s.label} className="cal__legend"><i style={{ background: s.bg }} />{s.label}</span>
            ))}
          </p>
        </div>
      </div>
    </main>
  );
}
