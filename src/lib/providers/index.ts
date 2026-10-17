/** Реестр коннекторов. Возвращает провайдер по типу сети. */
import type { Provider } from "@prisma/client";
import type { SocialProvider } from "./types";
import { youtubeProvider } from "./youtube";
import { facebookProvider } from "./meta";
import { instagramProvider } from "./instagram";
import { tiktokProvider } from "./tiktok";
import { telegramProvider } from "./telegram";
import { linkedinProvider } from "./linkedin";

const registry: Partial<Record<Provider, SocialProvider>> = {
  YOUTUBE: youtubeProvider,
  FACEBOOK: facebookProvider,
  INSTAGRAM: instagramProvider, // Instagram Login flow (src/lib/providers/instagram.ts)
  TIKTOK: tiktokProvider,
  TELEGRAM: telegramProvider, // подключается токеном бота, без OAuth
  LINKEDIN: linkedinProvider,
};

export function getProvider(provider: Provider): SocialProvider | undefined {
  return registry[provider];
}

/** Коннектор, который подключается через OAuth (у Telegram его нет). */
export type OAuthProvider = SocialProvider &
  Required<Pick<SocialProvider, "getAuthUrl" | "handleCallback">>;

export function getOAuthProvider(provider: Provider): OAuthProvider | undefined {
  const p = registry[provider];
  return p?.getAuthUrl && p.handleCallback ? (p as OAuthProvider) : undefined;
}
