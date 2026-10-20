/** POST /api/invites — создать инвайт-код (только владелец). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createInvite } from "@/lib/invites";

export async function POST(req: Request) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  if (user.role !== "OWNER") {
    return NextResponse.redirect(new URL("/dashboard", env.APP_URL));
  }

  const form = await req.formData().catch(() => null);
  const email = form?.get("email") ? String(form.get("email")) : undefined;
  const expiresRaw = form?.get("expiresDays");
  const expiresDays = expiresRaw ? Number(expiresRaw) : undefined;
  const role = form?.get("role") === "VIEWER" ? "VIEWER" : "FRIEND";

  await createInvite(user.id, {
    email,
    expiresDays: Number.isFinite(expiresDays) ? expiresDays : undefined,
    role,
  });

  return NextResponse.redirect(new URL("/invites?created=1", env.APP_URL), {
    status: 303,
  });
}
