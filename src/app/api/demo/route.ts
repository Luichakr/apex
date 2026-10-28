/** POST /api/demo — включить или выключить демо-режим (cookie), вернуться назад. */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { DEMO_COOKIE } from "@/lib/demo";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const env = getEnv();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL), 303);
  const form = await req.formData().catch(() => null);
  const on = form?.get("on") === "1";
  const back = String(form?.get("back") ?? "/dashboard");
  const res = NextResponse.redirect(new URL(back.startsWith("/") ? back : "/dashboard", env.APP_URL), 303);
  res.cookies.set(DEMO_COOKIE, on ? "1" : "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: on ? 7 * 86_400 : 0,
  });
  return res;
}
