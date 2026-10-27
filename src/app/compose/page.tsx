import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, canPublish } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import ComposeForm from "./compose-form";

export const metadata: Metadata = { title: "Новый пост" };
export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canPublish(user)) redirect("/posts");

  const accounts = await prisma.socialAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, displayName: true, meta: true },
  });
  const snippets = await prisma.captionSnippet.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, text: true },
  });

  return (
    <main>
      <div className="grid page-head">
        <div className="z-basic">
          <h1>Новый пост.</h1>
          <p className="lead">Четыре шага: видео, сети, текст, время. Остальное APEX сделает сам — в каждую сеть в её лучшем качестве.</p>
        </div>
      </div>
      <div className="grid">
        <div className="z-basic">
          {accounts.length === 0 ? (
            <div className="panel stack-sm">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Сначала подключите сеть.</h2>
              <p className="muted">Хотя бы одну: YouTube, Instagram или TikTok.</p>
              <div>
                <Link className="btn" href="/accounts"><Icon name="link" /> К аккаунтам</Link>
              </div>
            </div>
          ) : (
            <ComposeForm accounts={accounts} snippets={snippets} />
          )}
        </div>
      </div>
    </main>
  );
}
