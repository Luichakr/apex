/** GET /api/connect/meta/start — подключение Facebook + Instagram (редирект в Meta). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv, configuredProviders } from "@/lib/env";
import { metaAuthUrl } from "@/lib/providers/meta";
import { setOAuthState } from "@/lib/oauth-state";

export async function GET() {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  if (user.role === "VIEWER") return NextResponse.redirect(new URL("/accounts?error=viewer", env.APP_URL), 303);

  if (!configuredProviders().meta) {
    return NextResponse.redirect(
      new URL("/accounts?error=meta_not_configured", env.APP_URL)
    );
  }

  const state = await setOAuthState("meta");
  return NextResponse.redirect(metaAuthUrl(state));
}
