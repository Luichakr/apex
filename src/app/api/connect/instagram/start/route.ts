/** GET /api/connect/instagram/start — начать подключение Instagram (вход через Instagram). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv, configuredProviders } from "@/lib/env";
import { getOAuthProvider } from "@/lib/providers";
import { setOAuthState } from "@/lib/oauth-state";

export async function GET() {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  if (user.role === "VIEWER") return NextResponse.redirect(new URL("/accounts?error=viewer", env.APP_URL), 303);

  if (!configuredProviders().instagram) {
    return NextResponse.redirect(
      new URL("/accounts?error=instagram_not_configured", env.APP_URL)
    );
  }

  const provider = getOAuthProvider("INSTAGRAM")!;
  const state = await setOAuthState("instagram");
  return NextResponse.redirect(provider.getAuthUrl(state));
}
