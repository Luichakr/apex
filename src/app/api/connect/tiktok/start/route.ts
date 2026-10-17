/** GET /api/connect/tiktok/start — начать подключение TikTok. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv, configuredProviders } from "@/lib/env";
import { getOAuthProvider } from "@/lib/providers";
import { setOAuthState } from "@/lib/oauth-state";

export async function GET() {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  if (!configuredProviders().tiktok) {
    return NextResponse.redirect(
      new URL("/accounts?error=tiktok_not_configured", env.APP_URL)
    );
  }

  const provider = getOAuthProvider("TIKTOK")!;
  const state = await setOAuthState("tiktok");
  return NextResponse.redirect(provider.getAuthUrl(state));
}
