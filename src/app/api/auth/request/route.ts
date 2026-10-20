/** POST /api/auth/request — запросить ссылку входа на email. */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { checkAccess } from "@/lib/access";
import { clientIp } from "@/lib/auth";
import { hmacToken, randomToken } from "@/lib/crypto";
import { sendMagicLink } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().email().max(254),
  inviteCode: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const env = getEnv();
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const inviteCode = parsed.data.inviteCode?.trim() || undefined;

  // Защита от перебора и рассылки спама: по IP и по адресу.
  const ip = clientIp(await headers()) ?? "unknown";
  const allowed =
    (await rateLimit(`auth-ip:${ip}`, 10, 15 * 60)) &&
    (await rateLimit(`auth-email:${email}`, 3, 15 * 60));
  if (!allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите 15 минут и попробуйте снова." },
      { status: 429 }
    );
  }

  const access = await checkAccess(email, inviteCode);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  // Одноразовый токен входа (в БД — только хэш). Инвайт привязывается к токену
  // и тратится только при входе, атомарно.
  const token = randomToken(32);
  const tokenHash = hmacToken(token, "MAGIC_LINK_SECRET");
  const expiresAt = new Date(Date.now() + 15 * 60_000); // 15 минут

  await prisma.magicToken.create({
    data: {
      email,
      tokenHash,
      expiresAt,
      inviteCode: access.willCreate ? inviteCode : null,
      grantRole: access.willCreate ? access.role ?? null : null,
    },
  });

  // Ссылка ведёт на страницу подтверждения: почтовые сканеры, открывающие
  // ссылки заранее, не «сожгут» вход — он происходит только по нажатию кнопки.
  const url = new URL("/auth/confirm", env.APP_URL);
  url.searchParams.set("token", token);

  await sendMagicLink(email, url.toString());
  return NextResponse.json({ ok: true });
}
