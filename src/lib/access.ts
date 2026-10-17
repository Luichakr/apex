/**
 * Кто имеет право войти (закрытый доступ только для приглашённых).
 * Правила:
 *   - OWNER_EMAIL — всегда можно, получает роль OWNER.
 *   - Уже существующий пользователь — можно.
 *   - Новый email — только при действующем инвайт-коде.
 */
import { prisma } from "./db";
import { getEnv } from "./env";

export type AccessCheck =
  | { ok: true; willCreate: boolean }
  | { ok: false; reason: string };

export async function checkAccess(
  email: string,
  inviteCode?: string
): Promise<AccessCheck> {
  const env = getEnv();
  const normalized = email.trim().toLowerCase();

  if (env.OWNER_EMAIL && normalized === env.OWNER_EMAIL.toLowerCase()) {
    return { ok: true, willCreate: !(await userExists(normalized)) };
  }

  if (await userExists(normalized)) {
    return { ok: true, willCreate: false };
  }

  if (!inviteCode) {
    return { ok: false, reason: "Нужен инвайт-код для первого входа" };
  }

  const invite = await prisma.invite.findUnique({
    where: { code: inviteCode.trim() },
  });
  if (!invite) return { ok: false, reason: "Инвайт-код не найден" };
  if (invite.usedAt) return { ok: false, reason: "Инвайт-код уже использован" };
  if (invite.expiresAt && invite.expiresAt < new Date())
    return { ok: false, reason: "Срок действия инвайт-кода истёк" };
  if (invite.email && invite.email.toLowerCase() !== normalized)
    return { ok: false, reason: "Инвайт-код выдан для другого email" };

  return { ok: true, willCreate: true };
}

async function userExists(email: string): Promise<boolean> {
  return Boolean(await prisma.user.findUnique({ where: { email } }));
}

export class InviteError extends Error {}

/**
 * Создаёт пользователя при первом входе (если нужно) и атомарно тратит инвайт.
 * Один инвайт = один новый пользователь, даже при одновременных входах.
 * Возвращает id пользователя.
 */
export async function ensureUser(
  email: string,
  inviteCode?: string
): Promise<string> {
  const env = getEnv();
  const normalized = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return existing.id;

  const isOwner = Boolean(
    env.OWNER_EMAIL && normalized === env.OWNER_EMAIL.toLowerCase()
  );
  if (!isOwner && !inviteCode) throw new InviteError("Нужен инвайт-код");

  const user = await prisma.$transaction(async (tx) => {
    if (!isOwner) {
      const now = new Date();
      const spent = await tx.invite.updateMany({
        where: {
          code: inviteCode!.trim(),
          usedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [{ OR: [{ email: null }, { email: { equals: normalized, mode: "insensitive" } }] }],
        },
        data: { usedAt: now, usedByEmail: normalized },
      });
      if (spent.count !== 1) throw new InviteError("Инвайт-код уже использован или истёк");
    }
    return tx.user.create({
      data: { email: normalized, role: isOwner ? "OWNER" : "FRIEND" },
    });
  });

  await prisma.auditLog
    .create({
      data: { userId: user.id, action: "user_created", detail: { email: normalized } },
    })
    .catch(() => {});

  return user.id;
}
