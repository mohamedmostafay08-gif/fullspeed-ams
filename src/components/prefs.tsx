"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Languages, Monitor, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { isMuted, playSound, setMuted, subscribeMuted } from "@/lib/fx";
import { setLocale, setTheme } from "@/app/actions/prefs";
import { useLocale, useT } from "@/lib/i18n/client";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: Monitor, light: Sun, dark: Moon };
const LABEL: Record<Theme, string> = { system: "حسب الجهاز", light: "فاتح", dark: "غامق" };

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // The head script owns the logic (and the OS listener), so the toggle and the first paint agree.
  const apply = (window as Window & { __applyTheme?: () => void }).__applyTheme;
  if (apply) return apply();
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

const BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold text-zinc-500 transition hover:bg-zinc-100 hover:text-ink active:scale-95 disabled:opacity-60";

export function PrefsControls({ theme: initial, sound = false }: { theme: Theme; sound?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [theme, setLocal] = useState<Theme>(initial);
  const [pending, start] = useTransition();
  const Icon = ICON[theme];
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);

  return (
    <div className="flex items-center">
      <button
        type="button"
        className={BTN}
        disabled={pending}
        onClick={() => start(() => setLocale(locale === "ar" ? "en" : "ar"))}
        aria-label={locale === "ar" ? "Switch to English" : "التحويل للعربي"}
        title={locale === "ar" ? "English" : "العربية"}
      >
        <Languages size={17} />
        <span>{locale === "ar" ? "EN" : "ع"}</span>
      </button>
      {sound && (
        <button
          type="button"
          className={BTN}
          onClick={() => {
            setMuted(!muted);
            if (muted) playSound("notify");
          }}
          aria-pressed={!muted}
          aria-label={muted ? t("الصوت مقفول") : t("الصوت شغال")}
          title={muted ? t("الصوت مقفول") : t("الصوت شغال")}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      )}
      <button
        type="button"
        className={BTN}
        onClick={() => {
          const next = NEXT[theme];
          setLocal(next);
          applyTheme(next);
          start(() => setTheme(next));
        }}
        aria-label={t("المظهر: {0}", t(LABEL[theme]))}
        title={t("المظهر: {0}", t(LABEL[theme]))}
      >
        <Icon size={17} />
      </button>
    </div>
  );
}
