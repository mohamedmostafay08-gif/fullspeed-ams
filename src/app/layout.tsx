import type { Metadata, Viewport } from "next";
import { Cairo, Readex_Pro } from "next/font/google";
import { ServiceWorkerRegistrar } from "@/components/pwa";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale, getTheme } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/translate";
import "./globals.css";

const cairo = Cairo({ variable: "--font-cairo", subsets: ["arabic", "latin"] });
const readex = Readex_Pro({ variable: "--font-readex", subsets: ["arabic", "latin"] });

export const metadata: Metadata = {
  title: "Full Speed — Acquisition",
  description: "Full Speed acquisition team system",
  applicationName: "Full Speed",
  appleWebApp: { capable: true, title: "Full Speed", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/favicon-32.png", sizes: "32x32" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d17" },
  ],
};

// Applies the OS colour scheme before first paint when the user has not picked one.
const SYSTEM_THEME = `(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.classList.toggle('dark',m.matches)}a();m.addEventListener('change',a)})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      data-theme={theme}
      className={`${cairo.variable} ${readex.variable} h-full antialiased ${theme === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <head>{theme === "system" && <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME }} />}</head>
      <body className="min-h-full font-sans">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
