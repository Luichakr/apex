/** Общий интерфейс коннектора соцсети. */
import type { Provider } from "@prisma/client";

/** Аккаунт с уже расшифрованными токенами (живёт только в памяти, не в БД). */
export type DecryptedAccount = {
  id: string;
  userId: string;
  provider: Provider;
  providerAccountId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scope: string | null;
  meta: Record<string, unknown> | null;
};

/** Результат подключения аккаунта (после OAuth-коллбэка). */
export type ConnectResult = {
  providerAccountId: string;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  meta?: Record<string, unknown>;
};

/** Входные данные для публикации одного видео. */
export type PublishInput = {
  filePath: string;
  mimeType: string;
  caption: string;
  /** Короткий заголовок (для YouTube). Если не задан — берётся из caption. */
  title?: string;
  /** Настройки публикации для этой сети (приватность, категория и т.п.). */
  settings?: Record<string, string | boolean>;
  /** Кадр-обложка: миллисекунда от начала ролика (null — решает сеть). */
  coverMs?: number | null;
  /** Отрисовать обложку в JPEG нужного размера (ffmpeg на сервере). */
  renderCover?: (maxWidth: number) => Promise<Buffer | null>;
  /** Путь к загруженной пользователем картинке-обложке (если есть). */
  coverImagePath?: string | null;
  /** Длительность готового файла в секундах (для проверок площадки). */
  durationSec?: number;
  /** Номер попытки (1 — первая). */
  attempt?: number;
  /** id контейнера/загрузки, сохранённый прошлой попыткой (для безопасного повтора). */
  remoteId?: string | null;
  /** Пост создан в это время — для поиска уже загруженного видео при повторе. */
  notBefore?: Date;
  /** Сохранить id контейнера/загрузки, как только площадка его выдала. */
  saveRemoteId?: (id: string) => Promise<void>;
  /** Сообщить этап (upload / processing) для интерфейса. */
  onStage?: (stage: string) => Promise<void>;
};

export type PublishResult = {
  externalId: string;
  externalUrl?: string;
  /** Пометка, что опубликовано как черновик/приватно (например, TikTok без аудита). */
  draft?: boolean;
  /** Публикация прошла, но что-то второстепенное не удалось (например, обложка). */
  note?: string;
};

/**
 * Текущие показатели публикации, снятые у площадки.
 * Поля необязательные: у разных сетей разный набор, и часть площадок
 * (например, LinkedIn для личного профиля) охваты не отдаёт.
 */
export type FetchedMetrics = {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** Сырой ответ площадки — на случай добавления новых показателей. */
  raw?: unknown;
};

/** Данные публикации, которые нужно показать коннектору для сбора метрик. */
export type MetricsTarget = {
  externalId: string;
  settings?: Record<string, unknown> | null;
  renditionMeta?: Record<string, unknown> | null;
};

export interface SocialProvider {
  id: Provider;
  /**
   * Ссылка, куда отправить пользователя для авторизации.
   * Необязательна: Telegram подключается токеном бота, без перехода на сайт.
   */
  getAuthUrl?(state: string): string;
  /** Обмен кода авторизации на токены + данные аккаунта. */
  handleCallback?(code: string): Promise<ConnectResult>;
  /** Опубликовать видео. */
  publish(account: DecryptedAccount, input: PublishInput): Promise<PublishResult>;
  /** Обновить access-токен, если истёк (вернуть актуальный аккаунт). */
  ensureFreshToken?(account: DecryptedAccount): Promise<DecryptedAccount>;
  /** Отозвать доступ на стороне площадки (при отключении аккаунта). */
  revoke?(account: DecryptedAccount): Promise<void>;
  /**
   * Снять текущие показатели публикации у площадки.
   * null — площадка не отдаёт метрики для такой публикации (например, TikTok
   * до аудита, Telegram для чата а не канала, LinkedIn для личного профиля).
   */
  fetchMetrics?(
    account: DecryptedAccount,
    target: MetricsTarget
  ): Promise<FetchedMetrics | null>;
  /** Поставить лайк чужой публикации (официальный API, только по клику человека). */
  like?(account: DecryptedAccount, externalId: string): Promise<void>;
  /** Написать комментарий под чужой публикацией. */
  comment?(account: DecryptedAccount, externalId: string, text: string): Promise<void>;
}
