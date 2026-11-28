"use client";

import { Banknote, Bike, Clock, ListChecks } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { Terms } from "@/lib/terms";

/** The company's pay and work terms, as the agent tells them to the captain. */
export function CompanyTerms({ terms, compact = false }: { terms: Partial<Terms>; compact?: boolean }) {
  const t = useT();
  const rows: { icon: typeof Banknote; label: string; value: string }[] = [];
  if (terms.salary) rows.push({ icon: Banknote, label: t("المرتب"), value: terms.salary });
  if (terms.order_price) rows.push({ icon: Bike, label: t("سعر الأوردر"), value: terms.order_price });
  if (terms.working_hours) rows.push({ icon: Clock, label: t("عدد الساعات"), value: terms.working_hours });
  for (const x of terms.terms ?? []) rows.push({ icon: ListChecks, label: x.label, value: x.value });
  if (!rows.length) return null;
  return (
    <dl className={`grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm">
          <r.icon size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <dt className="text-xs text-zinc-500">{r.label}</dt>
            <dd className="font-semibold">{r.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
