/**
 * Валидация и доступ к переменным окружения.
 * Критичные для безопасности значения проверяются при старте.
 */
import { z } from "zod";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "ожидается base64-ключ длиной 32 байта (сгенерируйте: npm run keygen)",
  })
  // Ключ из одного повторяющегося байта — признак того, что его «придумали»
  // руками, а не сгенерировали. Такой подбирается мгновенно.
  .refine((v) => new Set(Buffer.from(v, "base64")).size > 4, {
    message: "ключ слишком однообразный — сгенерируйте его командой npm run keygen",
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url(),
  APP_NAME: z.string().default("APEX"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  TOKEN_ENCRYPTION_KEY: base64Key,
  SESSION_SECRET: base64Key,
  MAGIC_LINK_SECRET: base64Key,

  OWNER_EMAIL: z.string().email().optional().or(z.literal("")),

  SMTP_HOST: z.string().optional().or(z.literal("")),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional().or(z.literal("")),
  SMTP_PASSWORD: z.string().optional().or(z.literal("")),
  SMTP_FROM: z.string().optional().or(z.literal("")),

  // Ключи площадок — опциональны: что заполнено, то и доступно.
  META_APP_ID: z.string().optional().or(z.literal("")),
  META_APP_SECRET: z.string().optional().or(z.literal("")),
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal("")),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal("")),
  TIKTOK_CLIENT_KEY: z.string().optional().or(z.literal("")),
  TIKTOK_CLIENT_SECRET: z.string().optional().or(z.literal("")),
  // Instagram API с входом через Instagram (отдельные от Meta ключи)
  INSTAGRAM_APP_ID: z.string().optional().or(z.literal("")),
  INSTAGRAM_APP_SECRET: z.string().optional().or(z.literal("")),

  // Facebook-Страницы (требует бизнес-верификации Meta) — включается явно.
  META_ENABLE_FACEBOOK: z.string().optional(),
  // Печатать ссылки входа в лог, если SMTP не настроен (только для своего сервера).
  LOG_MAGIC_LINKS: z.string().optional(),
});

/**
 * Ключи должны быть разными: одним и тем же шифруются токены соцсетей,
 * подписываются сессии и ссылки входа — совпадение означает, что утечка
 * одной подписи вскрывает и всё остальное.
 */
const checkedSchema = schema.refine(
  (e) => new Set([e.TOKEN_ENCRYPTION_KEY, e.SESSION_SECRET, e.MAGIC_LINK_SECRET]).size === 3,
  { message: "TOKEN_ENCRYPTION_KEY, SESSION_SECRET и MAGIC_LINK_SECRET должны быть разными (npm run keygen выдаёт все три сразу)" }
);

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = checkedSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Ошибка конфигурации (.env):\n${issues}\n\nПодсказка: скопируйте .env.example в .env и выполните npm run keygen.`
    );
  }
  cached = parsed.data;
  return cached;
}

/** Какие площадки настроены (есть ключи). Используется для показа кнопок подключения. */
export function configuredProviders() {
  const e = getEnv();
  return {
    meta: Boolean(e.META_APP_ID && e.META_APP_SECRET && e.META_ENABLE_FACEBOOK === "1"),
    instagram: Boolean(e.INSTAGRAM_APP_ID && e.INSTAGRAM_APP_SECRET),
    youtube: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    tiktok: Boolean(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET),
    // Telegram не требует ключей на сервере: токен бота вводит сам владелец.
    telegram: true,
  };
}
