/** POST /api/auth/logout — выйти (удалить сессию). */
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { destroySession } from "@/lib/auth";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(new URL("/login", getEnv().APP_URL), {
    status: 303,
  });
}
