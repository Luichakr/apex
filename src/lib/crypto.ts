/**
 * Шифрование токенов соцсетей.
 *
 * Принципы безопасности:
 *  - AES-256-GCM (аутентифицированное шифрование: защищает и от чтения, и от подмены).
 *  - Ключ (TOKEN_ENCRYPTION_KEY) живёт только в окружении, НЕ в базе рядом с данными.
 *  - AAD (additional authenticated data) привязывает шифртекст к конкретному
 *    пользователю и площадке. Строку, скопированную в чужую строку БД, расшифровать
 *    не получится — это защита от cross-user/cross-provider подмены.
 *  - Формат хранения: "v1:" + base64(iv[12] | authTag[16] | ciphertext).
 *
 * Если TOKEN_ENCRYPTION_KEY будет утерян — расшифровать токены станет невозможно
 * (это ожидаемо; делайте шифрованный бэкап ключа, см. scripts/backup.sh).
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
  createHmac,
  scryptSync,
} from "node:crypto";

const VERSION = "v1";
const IV_LENGTH = 12; // рекомендуемый размер nonce для GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY не задан. Сгенерируйте ключи командой: npm run keygen"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY должен быть 32 байта в base64 (получено ${key.length}). Перегенерируйте: npm run keygen`
    );
  }
  cachedKey = key;
  return key;
}

/** AAD строится из контекста владения токеном. */
export function tokenAad(userId: string, provider: string): Buffer {
  return Buffer.from(`${userId}:${provider}`, "utf8");
}

/**
 * Зашифровать строку (токен). aad — контекст владения (tokenAad(...)).
 * Возвращает строку для хранения в БД.
 */
export function encrypt(plaintext: string, aad: Buffer): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]);
  return `${VERSION}:${payload.toString("base64")}`;
}

/**
 * Расшифровать строку, созданную encrypt(). aad должен совпадать с тем,
 * что использовался при шифровании, иначе расшифровка не пройдёт.
 */
export function decrypt(stored: string, aad: Buffer): string {
  const key = getKey();
  const [version, data] = stored.split(":", 2);
  if (version !== VERSION || !data) {
    throw new Error("Неизвестный формат зашифрованного значения");
  }
  const payload = Buffer.from(data, "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Удобные обёртки: шифруем/расшифровываем токен в контексте (user, provider). */
export function encryptToken(
  plaintext: string,
  userId: string,
  provider: string
): string {
  return encrypt(plaintext, tokenAad(userId, provider));
}

export function decryptToken(
  stored: string,
  userId: string,
  provider: string
): string {
  return decrypt(stored, tokenAad(userId, provider));
}

/**
 * Хэш для одноразовых токенов (magic-link, сессии).
 * Используем HMAC с секретом, чтобы в БД не лежало ничего, чем можно войти напрямую.
 */
export function hmacToken(token: string, secretEnvName: string): string {
  const secret = process.env[secretEnvName];
  if (!secret) throw new Error(`${secretEnvName} не задан (см. npm run keygen)`);
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(token)
    .digest("hex");
}

/** Сравнение строк, устойчивое к тайминг-атакам. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Непредсказуемый случайный токен (для ссылок входа и сессий). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Короткий отпечаток значения — для логов/аудита без раскрытия самого значения. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// --- Пароли -----------------------------------------------------------------
// Вход по паролю — для self-hosted без настроенной почты. Храним scrypt-хэш
// с солью: даже при утечке базы пароль не восстановить.
/** Хэш пароля: scrypt, случайная соль. Формат: scrypt$<соль>$<хэш> (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Проверка пароля в постоянное время. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password.normalize("NFKC"), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
