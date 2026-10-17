/** GET /api/connect/linkedin/start — начать подключение LinkedIn. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv, configuredProviders } from "@/lib/env";
import { getOAuthProvider } from "@/lib/providers";
import { setOAuthState } from "@/lib/oauth-state";

export async function GET() {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  if (!configuredProviders().linkedin) {
    return NextResponse.redirect(
      new URL("/accounts?error=linkedin_not_configured", env.APP_URL)
    );
  }

  const provider = getOAuthProvider("LINKEDIN")!;
  const state = await setOAuthState("linkedin");
  return NextResponse.redirect(provider.getAuthUrl(state));
}
