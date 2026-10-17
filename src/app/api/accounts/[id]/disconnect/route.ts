/** POST /api/accounts/:id/disconnect — отключить соцсеть (отозвать + удалить токены). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { disconnectAccount } from "@/lib/accounts";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const { id } = await params;
  await disconnectAccount(id, user.id);
  return NextResponse.redirect(new URL("/accounts?disconnected=1", env.APP_URL), {
    status: 303,
  });
}
