"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type T } from "./translate";

const LocaleContext = createContext<Locale>("ar");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): T {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}
