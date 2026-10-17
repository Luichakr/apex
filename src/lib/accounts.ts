/**
 * Хранение подключённых аккаунтов соцсетей.
 * Токены всегда шифруются перед записью и расшифровываются только в памяти.
 */
import type { Provider } from "@prisma/client";
import { prisma } from "./db";
import { encryptToken, decryptToken } from "./crypto";
import type { ConnectResult, DecryptedAccount } from "./providers/types";

/** Сохранить (или обновить) подключённый аккаунт с шифрованием токенов. */
export async function saveAccount(
  userId: string,
  provider: Provider,
  data: ConnectResult
): Promise<string> {
  const accessTokenEnc = encryptToken(data.accessToken, userId, provider);
  const refreshTokenEnc = data.refreshToken
    ? encryptToken(data.refreshToken, userId, provider)
    : null;

  const account = await prisma.socialAccount.upsert({
    where: {
      userId_provider_providerAccountId: {
        userId,
        provider,
        providerAccountId: data.providerAccountId,
      },
    },
    update: {
      displayName: data.displayName ?? null,
      // Переподключили — снимаем пометку «нужен повторный вход».
      needsReconnect: false,
      reconnectReason: null,
      accessTokenEnc,
      // не затираем refresh-токен, если площадка прислала пустой при повторном connect
      ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
      tokenExpiresAt: data.expiresAt ?? null,
      scope: data.scope ?? null,
      meta: (data.meta ?? undefined) as object | undefined,
    },
    create: {
      userId,
      provider,
      providerAccountId: data.providerAccountId,
      displayName: data.displayName ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt: data.expiresAt ?? null,
      scope: data.scope ?? null,
      meta: (data.meta ?? undefined) as object | undefined,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        userId,
        action: "connect_account",
        detail: { provider, account: data.displayName ?? data.providerAccountId },
      },
    })
    .catch(() => {});

  return account.id;
}

/** Загрузить аккаунт и расшифровать токены (только для владельца аккаунта). */
export async function getDecryptedAccount(
  accountId: string
): Promise<DecryptedAccount | null> {
  const a = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!a) return null;
  return {
    id: a.id,
    userId: a.userId,
    provider: a.provider,
    providerAccountId: a.providerAccountId,
    displayName: a.displayName,
    accessToken: decryptToken(a.accessTokenEnc, a.userId, a.provider),
    refreshToken: a.refreshTokenEnc
      ? decryptToken(a.refreshTokenEnc, a.userId, a.provider)
      : null,
    tokenExpiresAt: a.tokenExpiresAt,
    scope: a.scope,
    meta: (a.meta as Record<string, unknown> | null) ?? null,
  };
}

/** Обновить сохранённые токены (после refresh). */
export async function updateStoredTokens(
  account: DecryptedAccount,
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }
): Promise<void> {
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encryptToken(tokens.accessToken, account.userId, account.provider),
      ...(tokens.refreshToken
        ? {
            refreshTokenEnc: encryptToken(
              tokens.refreshToken,
              account.userId,
              account.provider
            ),
          }
        : {}),
      tokenExpiresAt: tokens.expiresAt ?? account.tokenExpiresAt,
    },
  });
}

/** Отключить аккаунт: отозвать доступ и удалить запись (с токенами). */
export async function disconnectAccount(
  accountId: string,
  userId: string
): Promise<boolean> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account || account.userId !== userId) return false;

  // Попытка отозвать токен у площадки (не критично, если не вышло).
  try {
    const { getProvider } = await import("./providers");
    const provider = getProvider(account.provider);
    if (provider?.revoke) {
      const dec = await getDecryptedAccount(accountId);
      if (dec) await provider.revoke(dec);
    }
  } catch {
    // игнорируем — всё равно удаляем локально
  }

  await prisma.socialAccount.delete({ where: { id: accountId } });
  await prisma.auditLog
    .create({
      data: { userId, action: "disconnect_account", detail: { provider: account.provider } },
    })
    .catch(() => {});
  return true;
}
