import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { ServiceWorkerRegistrar } from "@/components/pwa";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale, getTheme } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/translate";
import "./globals.css";

// One calm, readable face for Arabic and Latin in both themes (Work-First redesign).
const plex = IBM_Plex_Sans_Arabic({ variable: "--font-plex", subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap" });

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

// Runs before first paint on every page. The saved choice lives on <html data-theme>; "system" follows
// the device and keeps following it when the OS switches (sunset, battery saver), while an explicit
// light/dark choice ignores OS changes. It also points the browser bar colour at the active theme.
const THEME_SCRIPT = `(function(){var r=document.documentElement,m=window.matchMedia('(prefers-color-scheme: dark)');function a(){var t=r.dataset.theme,d=t==='dark'||(t!=='light'&&m.matches);r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';document.querySelectorAll('meta[name="theme-color"]').forEach(function(e){e.content=d?'#0b0d17':'#fbf3ec'})}window.__applyTheme=a;a();m.addEventListener('change',a)})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      data-theme={theme}
      // The "dark" class is owned by THEME_SCRIPT, never by React: if React rendered it, the refresh
      // after saving the theme would rewrite the class list and drop the OS-driven dark mode.
      className={`${plex.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
