/** POST /api/auth/password — вход по email и паролю (альтернатива ссылке на почту). */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { createSession, clientIp } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите email и пароль" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  // Защита от перебора пароля: по IP и по адресу.
  const ip = clientIp(await headers()) ?? "unknown";
  const allowed =
    (await rateLimit(`pw-ip:${ip}`, 15, 15 * 60)) &&
    (await rateLimit(`pw-email:${email}`, 8, 15 * 60));
  if (!allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите 15 минут." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Отвечаем одинаково, есть пользователь или нет — не раскрываем, кто заведён.
  if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  await createSession(user.id);
  await prisma.auditLog.create({ data: { userId: user.id, action: "login_password" } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
