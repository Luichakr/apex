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
}
