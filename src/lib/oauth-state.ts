/**
 * CSRF-защита OAuth: случайный state в httpOnly-cookie, сверяется в коллбэке.
 * У каждой площадки своя cookie — можно подключать две сети в соседних вкладках.
 */
import { cookies } from "next/headers";
import { randomToken, safeEqual } from "./crypto";

const cookieName = (provider: string) => `vp_oauth_${provider.toLowerCase()}`;

export async function setOAuthState(provider: string): Promise<string> {
  const state = randomToken(24);
  const store = await cookies();
  store.set(cookieName(provider), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600, // 1 час (с запасом на многошаговое согласие у площадки)
  });
  return state;
}

export async function verifyOAuthState(
  provider: string,
  received: string | null
): Promise<boolean> {
  if (!received) return false;
  const store = await cookies();
  const expected = store.get(cookieName(provider))?.value;
  store.delete(cookieName(provider));
  if (!expected) return false;
  return safeEqual(expected, received);
}
