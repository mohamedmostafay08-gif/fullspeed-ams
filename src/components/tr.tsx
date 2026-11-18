"use client";

import { useLocale, useT } from "@/lib/i18n/client";

/** Translates a fixed Arabic label inside components that render on both server and client. */
export function Tr({ text, args = [] }: { text: string; args?: (string | number)[] }) {
  const t = useT();
  return <>{t(text, ...args)}</>;
}

/** Localised date + time in Cairo time. */
export function When({ iso }: { iso: string | null | undefined }) {
  const locale = useLocale();
  if (!iso) return <>—</>;
  return (
    <>
      {new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
        timeZone: "Africa/Cairo",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso))}
    </>
  );
}
