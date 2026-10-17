import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AccountAlert from "@/components/AccountAlert";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <SiteHeader />
        <AccountAlert />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
