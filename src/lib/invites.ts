/** Инвайт-коды для закрытого доступа (создаёт владелец). */
import { randomBytes } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "./db";

// Алфавит без похожих символов (0/O, 1/I и т.п.) — код удобно диктовать.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function createInvite(
  ownerId: string,
  opts: { email?: string; expiresDays?: number; role?: Role } = {}
): Promise<string> {
  // Гарантируем уникальность кода.
  let code = randomCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.invite.findUnique({ where: { code } });
    if (!exists) break;
    code = randomCode();
  }

  const expiresAt =
    opts.expiresDays && opts.expiresDays > 0
      ? new Date(Date.now() + opts.expiresDays * 86_400_000)
      : null;

  await prisma.invite.create({
    data: {
      code,
      email: opts.email?.trim().toLowerCase() || null,
      createdById: ownerId,
      role: opts.role ?? "FRIEND",
      expiresAt,
    },
  });
  return code;
}

export async function deleteInvite(id: string): Promise<void> {
  // Удаляем только неиспользованные приглашения.
  await prisma.invite.deleteMany({ where: { id, usedAt: null } });
}
