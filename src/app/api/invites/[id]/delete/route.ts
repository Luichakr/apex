/** POST /api/invites/:id/delete — удалить неиспользованный инвайт (только владелец). */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { deleteInvite } from "@/lib/invites";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));
  if (user.role !== "OWNER") {
    return NextResponse.redirect(new URL("/dashboard", env.APP_URL));
  }

  const { id } = await params;
  await deleteInvite(id);
  return NextResponse.redirect(new URL("/invites?deleted=1", env.APP_URL), {
    status: 303,
  });
}
