/**
 * Аутентификация: сессии на основе httpOnly-cookie.
 *
 * В БД хранится только ХЭШ токена сессии (HMAC), а не сам токен — даже при утечке
 * базы войти по ней нельзя. Паролей нет: вход по одноразовой ссылке (magic-link).
 */
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { hmacToken, randomToken, safeEqual } from "./crypto";
import type { Role } from "@prisma/client";

const SESSION_COOKIE = "cc_session";
const SESSION_TTL_DAYS = 30;

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
};

/** Создать сессию для пользователя и поставить cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const tokenHash = hmacToken(token, "SESSION_SECRET");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);

  const hdrs = await headers();
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: hdrs.get("user-agent")?.slice(0, 300),
      ip: clientIp(hdrs),
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Прочитать текущего пользователя из cookie (или null). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hmacToken(token, "SESSION_SECRET");
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Защитное сравнение (на случай коллизий индекса).
  if (!safeEqual(session.tokenHash, tokenHash)) return null;

  // Обновим lastSeenAt не чаще раза в час.
  if (Date.now() - session.lastSeenAt.getTime() > 3600_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

/** Удалить текущую сессию (выход). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hmacToken(token, "SESSION_SECRET");
    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}

export function clientIp(hdrs: Headers): string | undefined {
  return (
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    undefined
  );
}
