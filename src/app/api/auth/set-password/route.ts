/** POST /api/auth/set-password — задать или сменить свой пароль (вошедший пользователь). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";

const schema = z.object({ password: z.string().min(8).max(200) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизованы" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const parsed = schema.safeParse({ password: form?.get("password") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Пароль — минимум 8 символов" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(parsed.data.password) },
  });
  const { getEnv } = await import("@/lib/env");
  return NextResponse.redirect(new URL("/settings?pw=set", getEnv().APP_URL), 303);
}
