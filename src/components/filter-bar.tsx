"use client";

import { useRef } from "react";
import Link from "next/link";
import { Filter, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * The one filter bar every list page uses: fields in one wrapping row, a dropdown or date applies at once,
 * a text box applies on Enter or «فلتر», and «امسح» shows only while something is filtered.
 */
export function FilterBar({ clearHref, active, children, className = "" }: { clearHref: string; active: boolean; children: React.ReactNode; className?: string }) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      role="search"
      onChange={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && (el.type === "date" || el.type === "month" || el.type === "checkbox"))) form.current?.requestSubmit();
      }}
      className={`mb-4 flex flex-wrap items-center gap-2 [&_.input]:w-auto [&_.input]:min-w-36 [&_.input]:flex-[1_1_9rem] [&_.input]:py-1.5 [&_.input]:text-sm [&_input[name=q]]:flex-[2_1_14rem] [&_input[type=date]]:flex-[0_1_10rem] ${className}`}
    >
      {children}
      <span className="flex items-center gap-2">
        <button className="btn-dark btn-sm"><Filter size={14} /> {t("فلتر")}</button>
        {active && (
          <Link href={clearHref} className="btn-ghost btn-sm text-zinc-500"><X size={14} /> {t("امسح كل الفلاتر")}</Link>
        )}
      </span>
    </form>
  );
}
