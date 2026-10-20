/**
 * POST /api/auth/verify — войти по одноразовой ссылке (кнопка на /auth/confirm).
 * GET оставлен для старых писем: он ничего не тратит, а ведёт на подтверждение.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { hmacToken } from "@/lib/crypto";
import { ensureUser, InviteError } from "@/lib/access";
import { createSession } from "@/lib/auth";

export async function GET(req: Request) {
  const env = getEnv();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const to = new URL("/auth/confirm", env.APP_URL);
  if (token) to.searchParams.set("token", token);
  return NextResponse.redirect(to, 303);
}

export async function POST(req: Request) {
  const env = getEnv();
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL), 303);

  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return redirectTo("/login?error=bad_link");

  const tokenHash = hmacToken(token, "MAGIC_LINK_SECRET");
  // Атомарно «сжигаем» токен: два одновременных запроса не войдут оба.
  const now = new Date();
  const spent = await prisma.magicToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (spent.count !== 1) return redirectTo("/login?error=expired");
  const record = await prisma.magicToken.findUnique({ where: { tokenHash } });
  if (!record) return redirectTo("/login?error=expired");

  let userId: string;
  try {
    userId = await ensureUser(record.email, record.inviteCode ?? undefined, record.grantRole ?? undefined);
  } catch (e) {
    if (e instanceof InviteError) return redirectTo("/login?error=invite_used");
    throw e;
  }
  await createSession(userId);
  await prisma.auditLog.create({ data: { userId, action: "login" } }).catch(() => {});
  return redirectTo("/dashboard");
}
