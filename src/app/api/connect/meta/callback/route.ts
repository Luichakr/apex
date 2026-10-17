/** GET /api/connect/meta/callback — сохраняем все Страницы FB и аккаунты IG. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { metaHandleCallback } from "@/lib/providers/meta";
import { saveAccount } from "@/lib/accounts";

export async function GET(req: Request) {
  const env = getEnv();
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/accounts?${q}`, env.APP_URL));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const { verifyOAuthState } = await import("@/lib/oauth-state");
  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code) return back("error=no_code");
  if (!(await verifyOAuthState("meta", state))) return back("error=bad_state");

  try {
    // Instagram подключается отдельно (вход через Instagram) — отсюда берём
    // только Страницы Facebook, чтобы не перезаписать рабочий токен Instagram.
    const accounts = (await metaHandleCallback(code)).filter(
      (a) => a.provider === "FACEBOOK"
    );
    for (const { provider, result } of accounts) {
      await saveAccount(user.id, provider, result);
    }
    return back(`connected=meta&count=${accounts.length}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
