/**
 * «Поддержать друга»: лайк и комментарий под публикацией другого участника APX.
 *
 * Принципы безопасности (все проверки — на сервере, интерфейс их не заменяет):
 *  - только вручную: каждое действие — отдельный клик человека, никаких автозапусков;
 *  - только официальный API (YouTube, LinkedIn), без браузера и паролей;
 *  - видны только публикации тех, кто сам разрешил (User.shareForSupport);
 *  - не свои посты, только опубликованные, публичные и свежие;
 *  - лимиты: не больше DAILY_LIMIT действий в сутки на аккаунт и пауза между ними;
 *  - комментарий проверяется: без ссылок, не копия прежних, не крик капсом;
 *  - действие записывается в БД до отправки — повторно то же самое не уйдёт;
 *  - каждое действие попадает в журнал аудита.
 */
import type { Prisma, PostTarget, Post, Provider } from "@prisma/client";
import { prisma } from "./db";
import { getDecryptedAccount } from "./accounts";
import { getProvider } from "./providers";
import { PlatformError } from "./providers/errors";

export const SUPPORT_PROVIDERS: Provider[] = ["YOUTUBE", "LINKEDIN"];
export const DAILY_LIMIT = 20;
export const MIN_GAP_MS = 45_000;
export const MAX_POST_AGE_DAYS = 14;
export const COMMENT_MIN = 3;
export const COMMENT_MAX = 300;

export const supportDisabled = () => process.env.SUPPORT_DISABLED === "1";

/** Запрос пришёл с нашего же сайта (защита от чужих страниц, шлющих клики от вашего имени). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(process.env.APP_URL ?? "").host;
  } catch {
    return false;
  }
}

/** Можно ли поддержать такую публикацию (без учёта лимитов). */
export function eligibleWhere(actorId: string): Prisma.PostTargetWhereInput {
  return {
    status: "DONE",
    isDraft: false,
    externalId: { not: null },
    provider: { in: SUPPORT_PROVIDERS },
    createdAt: { gte: new Date(Date.now() - MAX_POST_AGE_DAYS * 86_400_000) },
    post: { userId: { not: actorId }, user: { shareForSupport: true } },
  };
}

/** Публичная ли публикация: приватное и «по ссылке» трогать нельзя. */
export function isPublicTarget(t: Pick<PostTarget, "provider" | "settings">): boolean {
  const s = (t.settings ?? {}) as Record<string, unknown>;
  if (t.provider === "YOUTUBE") return s.privacy === undefined || s.privacy === "public";
  if (t.provider === "LINKEDIN") return s.visibility !== "CONNECTIONS";
  return false;
}

export type CommentCheck = { ok: true; text: string } | { ok: false; reason: string };

/** Проверка текста комментария до отправки. */
export function checkComment(raw: string, recent: string[] = []): CommentCheck {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < COMMENT_MIN) return { ok: false, reason: "Комментарий слишком короткий." };
  if (text.length > COMMENT_MAX) {
    return { ok: false, reason: `Комментарий длиннее ${COMMENT_MAX} символов.` };
  }
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ru|ua|eu|io|me|ly|to)\b/i.test(text)) {
    return { ok: false, reason: "Ссылки в комментариях не разрешены — соцсети считают это спамом." };
  }
  if ((text.match(/[@#]/g) ?? []).length > 2) {
    return { ok: false, reason: "Слишком много @ и #." };
  }
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 8 && letters === letters.toUpperCase()) {
    return { ok: false, reason: "Не пишите капсом." };
  }
  if (/(.)\1{5,}/u.test(text)) return { ok: false, reason: "Слишком много повторов символов." };
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (recent.some((r) => norm(r) === norm(text))) {
    return { ok: false, reason: "Такой комментарий вы уже писали — напишите по-новому, под это видео." };
  }
  return { ok: true, text };
}

export type SupportResult =
  | { ok: true; done: string[] }
  | { ok: false; reason: string; reconnect?: boolean };

/** Проверить лимиты аккаунта. null — можно. */
async function limitProblem(accountId: string): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000);
  const [count, last] = await Promise.all([
    prisma.supportAction.count({ where: { accountId, createdAt: { gte: since } } }),
    prisma.supportAction.findFirst({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  if (count >= DAILY_LIMIT) {
    return `Суточный лимит ${DAILY_LIMIT} действий исчерпан — продолжите завтра. Так мы бережём аккаунт от блокировки.`;
  }
  if (last && Date.now() - last.createdAt.getTime() < MIN_GAP_MS) {
    const wait = Math.ceil((MIN_GAP_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    return `Подождите ${wait} с — слишком частые действия похожи на бота.`;
  }
  return null;
}

/**
 * Выполнить лайк и/или комментарий от имени аккаунта участника.
 * Возвращает понятный результат; исключений наружу не бросает.
 */
export async function performSupport(opts: {
  actorId: string;
  actorRole: string;
  targetId: string;
  like: boolean;
  comment?: string;
}): Promise<SupportResult> {
  if (supportDisabled()) return { ok: false, reason: "Функция временно выключена владельцем." };
  if (opts.actorRole === "VIEWER") return { ok: false, reason: "Наблюдатель не может ставить реакции." };
  if (!opts.like && !opts.comment) return { ok: false, reason: "Выберите лайк или напишите комментарий." };

  const target = await prisma.postTarget.findFirst({
    where: { id: opts.targetId, ...eligibleWhere(opts.actorId) },
    include: { post: true },
  });
  if (!target || !target.externalId || !isPublicTarget(target)) {
    return { ok: false, reason: "Эту публикацию поддержать нельзя: она закрыта, устарела или не ваша к поддержке." };
  }

  const account = await prisma.socialAccount.findFirst({
    where: { userId: opts.actorId, provider: target.provider, needsReconnect: false },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    return { ok: false, reason: "У вас не подключён аккаунт этой сети (или нужно переподключить).", reconnect: true };
  }

  let commentText: string | undefined;
  if (opts.comment) {
    const recent = (
      await prisma.supportAction.findMany({
        where: { accountId: account.id, kind: "COMMENT", text: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { text: true },
      })
    ).map((r) => r.text!);
    const check = checkComment(opts.comment, recent);
    if (!check.ok) return { ok: false, reason: check.reason };
    commentText = check.text;
  }

  const provider = getProvider(target.provider);
  const kinds: { kind: "LIKE" | "COMMENT"; text?: string }[] = [];
  if (opts.like) kinds.push({ kind: "LIKE" });
  if (commentText) kinds.push({ kind: "COMMENT", text: commentText });
  if (kinds.some((k) => (k.kind === "LIKE" ? !provider?.like : !provider?.comment))) {
    return { ok: false, reason: "Эта сеть не поддерживает такое действие." };
  }

  const done: string[] = [];
  for (const k of kinds) {
    const problem = await limitProblem(account.id);
    if (problem) return done.length ? { ok: true, done: [...done, `(остановились: ${problem})`] } : { ok: false, reason: problem };

    // Сначала записываем намерение: уникальный ключ не даёт отправить дубль.
    let row;
    try {
      row = await prisma.supportAction.create({
        data: {
          actorId: opts.actorId,
          accountId: account.id,
          targetId: target.id,
          provider: target.provider,
          kind: k.kind,
          text: k.text ?? null,
        },
      });
    } catch {
      done.push(k.kind === "LIKE" ? "лайк уже стоял" : "комментарий уже был отправлен");
      continue;
    }

    try {
      let acc = (await getDecryptedAccount(account.id))!;
      if (provider!.ensureFreshToken) acc = await provider!.ensureFreshToken(acc);
      if (k.kind === "LIKE") await provider!.like!(acc, target.externalId);
      else await provider!.comment!(acc, target.externalId, k.text!);
      await prisma.supportAction.update({ where: { id: row.id }, data: { status: "SENT" } });
      await prisma.auditLog
        .create({
          data: {
            userId: opts.actorId,
            action: k.kind === "LIKE" ? "support_like" : "support_comment",
            detail: { provider: target.provider, targetId: target.id, ...(k.text ? { text: k.text } : {}) },
          },
        })
        .catch(() => {});
      done.push(k.kind === "LIKE" ? "лайк поставлен" : "комментарий отправлен");
    } catch (e) {
      // Не вышло — освобождаем ключ, чтобы можно было повторить позже.
      await prisma.supportAction.delete({ where: { id: row.id } }).catch(() => {});
      const reconnect = e instanceof PlatformError && e.resolution === "reconnect";
      return {
        ok: false,
        reconnect,
        reason: e instanceof Error ? e.message : "Площадка не приняла действие.",
      };
    }
  }
  return { ok: true, done };
}

export type SupportItem = {
  target: PostTarget & { post: Post & { user: { name: string | null; email: string } } };
  liked: boolean;
  commented: boolean;
};

/** Публикации друзей, которые можно поддержать, и что вы уже сделали. */
export async function listSupportItems(actorId: string): Promise<SupportItem[]> {
  const targets = await prisma.postTarget.findMany({
    where: eligibleWhere(actorId),
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { post: { include: { user: { select: { name: true, email: true } } } } },
  });
  const mine = await prisma.supportAction.findMany({
    where: { actorId, targetId: { in: targets.map((t) => t.id) } },
    select: { targetId: true, kind: true },
  });
  return targets
    .filter(isPublicTarget)
    .map((t) => ({
      target: t,
      liked: mine.some((m) => m.targetId === t.id && m.kind === "LIKE"),
      commented: mine.some((m) => m.targetId === t.id && m.kind === "COMMENT"),
    }));
}
