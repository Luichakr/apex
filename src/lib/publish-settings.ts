/**
 * Настройки публикации по сетям — одним описанием.
 *
 * Форма в композере строится из этой таблицы, а не пишется руками под каждую
 * площадку: добавить поле — значит дописать сюда строку. Здесь же живут
 * безопасные значения по умолчанию.
 *
 * Можно импортировать и на клиенте, и на сервере: только данные и чистые
 * функции.
 */
import type { Provider } from "@prisma/client";

export type FieldType = "select" | "toggle";

export type SettingField = {
  key: string;
  type: FieldType;
  label: string;
  /** Пояснение под полем — почему это важно. */
  hint?: string;
  /** Значение по умолчанию. */
  default: string | boolean;
  /** Варианты для select. */
  options?: { value: string; label: string; hint?: string }[];
  /** Показывать поле, только если другое поле имеет это значение. */
  showIf?: { key: string; equals: string | boolean };
  /**
   * Варианты приходят от площадки (например, уровни приватности TikTok
   * зависят от аккаунта и статуса аудита приложения).
   */
  optionsFrom?: "tiktokPrivacy";
  /** Площадка принимает это поле только при прямой публикации. */
  inboxIgnores?: boolean;
};

export type SettingGroup = {
  id: "content" | "distribution" | "disclosure";
  title: string;
  fields: SettingField[];
};

export const SETTINGS: Record<Provider, SettingGroup[]> = {
  YOUTUBE: [
    {
      id: "distribution",
      title: "Доступ",
      fields: [
        {
          key: "privacy",
          type: "select",
          label: "Кто увидит видео",
          default: "public",
          options: [
            { value: "public", label: "Публично — сразу всем" },
            { value: "unlisted", label: "По ссылке" },
            { value: "private", label: "Только мне" },
          ],
        },
        {
          key: "notifySubscribers",
          type: "toggle",
          label: "Уведомить подписчиков",
          default: true,
          showIf: { key: "privacy", equals: "public" },
        },
      ],
    },
    {
      id: "content",
      title: "Содержание",
      fields: [
        {
          key: "categoryId",
          type: "select",
          label: "Категория",
          default: "22",
          options: [
            { value: "22", label: "Люди и блоги" },
            { value: "24", label: "Развлечения" },
            { value: "10", label: "Музыка" },
            { value: "20", label: "Игры" },
            { value: "26", label: "Хобби и стиль" },
            { value: "28", label: "Наука и техника" },
            { value: "17", label: "Спорт" },
            { value: "19", label: "Путешествия" },
          ],
        },
      ],
    },
    {
      id: "disclosure",
      title: "Раскрытие",
      fields: [
        {
          key: "madeForKids",
          type: "toggle",
          label: "Видео для детей",
          default: false,
          hint: "У детского видео YouTube отключает комментарии и персональную рекламу.",
        },
      ],
    },
  ],

  INSTAGRAM: [
    {
      id: "distribution",
      title: "Распространение",
      fields: [
        {
          key: "shareToFeed",
          type: "toggle",
          label: "Показывать Reels в ленте профиля",
          default: true,
          hint: "Выключено — ролик будет только во вкладке Reels.",
        },
      ],
    },
  ],

  TIKTOK: [
    {
      id: "distribution",
      title: "Кто увидит",
      fields: [
        {
          key: "privacy",
          type: "select",
          label: "Уровень приватности",
          default: "SELF_ONLY",
          optionsFrom: "tiktokPrivacy",
          inboxIgnores: true,
          options: [
            { value: "SELF_ONLY", label: "Только я" },
            { value: "MUTUAL_FOLLOW_FRIENDS", label: "Друзья" },
            { value: "FOLLOWER_OF_CREATOR", label: "Подписчики" },
            { value: "PUBLIC_TO_EVERYONE", label: "Все" },
          ],
        },
      ],
    },
    {
      id: "content",
      title: "Взаимодействие",
      fields: [
        { key: "allowComment", type: "toggle", label: "Разрешить комментарии", default: true, inboxIgnores: true },
        { key: "allowDuet", type: "toggle", label: "Разрешить дуэты", default: true, inboxIgnores: true },
        { key: "allowStitch", type: "toggle", label: "Разрешить сшивки", default: true, inboxIgnores: true },
      ],
    },
    {
      id: "disclosure",
      title: "Раскрытие",
      fields: [
        {
          key: "aiGenerated",
          type: "toggle",
          label: "Создано с помощью ИИ",
          default: false,
          inboxIgnores: true,
          hint: "TikTok требует помечать сгенерированное содержимое.",
        },
        {
          key: "brandedContent",
          type: "toggle",
          label: "Коммерческое содержимое",
          default: false,
          inboxIgnores: true,
        },
      ],
    },
  ],

  FACEBOOK: [],
};

export type SettingsValues = Record<string, string | boolean>;

/** Значения по умолчанию для сети. */
export function defaultSettings(provider: Provider): SettingsValues {
  const out: SettingsValues = {};
  for (const group of SETTINGS[provider]) {
    for (const f of group.fields) out[f.key] = f.default;
  }
  return out;
}

/** Показывать ли поле при текущих значениях. */
export function fieldVisible(field: SettingField, values: SettingsValues): boolean {
  if (!field.showIf) return true;
  return values[field.showIf.key] === field.showIf.equals;
}

/** Значения с подстановкой умолчаний и отбрасыванием чужих ключей. */
export function resolveSettings(provider: Provider, stored: unknown): SettingsValues {
  const defaults = defaultSettings(provider);
  if (!stored || typeof stored !== "object") return defaults;
  const given = stored as Record<string, unknown>;
  const out: SettingsValues = { ...defaults };

  for (const group of SETTINGS[provider]) {
    for (const f of group.fields) {
      const v = given[f.key];
      if (v === undefined || v === null) continue;
      // Тип обязан совпасть с описанным: строка в поле-флаге означает, что
      // данные пришли испорченными, и безопаснее взять значение по умолчанию.
      if (f.type === "toggle") {
        if (typeof v === "boolean") out[f.key] = v;
        continue;
      }
      if (typeof v !== "string") continue;
      // Значение вне списка вариантов тоже не берём.
      const allowed = (f.options ?? []).map((o) => o.value);
      if (allowed.length === 0 || allowed.includes(v)) out[f.key] = v;
    }
  }
  return out;
}

/** Есть ли у сети что настраивать. */
export function hasSettings(provider: Provider): boolean {
  return SETTINGS[provider].some((g) => g.fields.length > 0);
}
