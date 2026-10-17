/** Реестр коннекторов. Возвращает провайдер по типу сети. */
import type { Provider } from "@prisma/client";
import type { SocialProvider } from "./types";
import { youtubeProvider } from "./youtube";
import { facebookProvider } from "./meta";
import { instagramProvider } from "./instagram";
import { tiktokProvider } from "./tiktok";

const registry: Partial<Record<Provider, SocialProvider>> = {
  YOUTUBE: youtubeProvider,
  FACEBOOK: facebookProvider,
  INSTAGRAM: instagramProvider, // Instagram Login flow (src/lib/providers/instagram.ts)
  TIKTOK: tiktokProvider,
};

export function getProvider(provider: Provider): SocialProvider | undefined {
  return registry[provider];
}
