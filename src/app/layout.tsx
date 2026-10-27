import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AccountAlert from "@/components/AccountAlert";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: { default: "APEX", template: "%s — APEX" },
  description:
    "Одно видео — сразу в YouTube Shorts, Instagram Reels и TikTok. Без потери качества, через официальные API.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="ru">
      <body>
        {user ? (
          <AppShell user={user}>
            <AccountAlert />
            {children}
          </AppShell>
        ) : (
          <>
            <SiteHeader />
            {children}
            <SiteFooter />
          </>
        )}
      </body>
    </html>
  );
}
