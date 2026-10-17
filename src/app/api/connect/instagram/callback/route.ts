/** GET /api/connect/instagram/callback — вернулись из Instagram, сохраняем аккаунт. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getOAuthProvider } from "@/lib/providers";
import { verifyOAuthState } from "@/lib/oauth-state";
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

  if (error) return back(`error=${encodeURIComponent(error)}`);
  if (!code) return back("error=no_code");
  if (!(await verifyOAuthState("instagram", state))) return back("error=bad_state");

  try {
    const provider = getOAuthProvider("INSTAGRAM")!;
    const result = await provider.handleCallback(code);
    await saveAccount(user.id, "INSTAGRAM", result);
    return back("connected=instagram");
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
