import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Вход" };

const ERRORS: Record<string, string> = {
  expired: "Ссылка для входа устарела или уже использована. Запросите новую.",
  bad_link: "Ссылка для входа неполная. Запросите новую.",
  invite_used: "Инвайт-код уже использован или истёк. Попросите новый у владельца.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser().catch(() => null)) redirect("/dashboard");
  const sp = await searchParams;
  return (
    <main className="grid section">
      <div className="z-narrow" style={{ maxWidth: 520 }}>
        <h1>Вход.</h1>
        <p className="lead" style={{ marginTop: "var(--sp-sm)" }}>
          Войдите по паролю или получите одноразовую ссылку на почту.
        </p>
        <LoginForm initialError={sp.error ? ERRORS[sp.error] ?? null : null} />
      </div>
    </main>
  );
}
