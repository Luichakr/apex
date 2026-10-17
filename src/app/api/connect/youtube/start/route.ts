/** GET /api/connect/youtube/start — начать подключение YouTube (редирект на Google). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv, configuredProviders } from "@/lib/env";
import { getProvider } from "@/lib/providers";
import { setOAuthState } from "@/lib/oauth-state";

export async function GET() {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  if (!configuredProviders().youtube) {
    return NextResponse.redirect(
      new URL("/accounts?error=youtube_not_configured", env.APP_URL)
    );
  }

  const provider = getProvider("YOUTUBE")!;
  const state = await setOAuthState("youtube");
  return NextResponse.redirect(provider.getAuthUrl(state));
}
