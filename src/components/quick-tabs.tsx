import Link from "next/link";
import { filtersToQuery, type LeadFilters, type LeadsView } from "@/lib/lead-query";
import { getT } from "@/lib/i18n/server";

type Quick = { key: string; label: string; status?: string; flag?: LeadFilters["flag"] };

export const AGENT_QUICK: Quick[] = [
  { key: "all", label: "الكل" },
  { key: "new", label: "جديد", status: "new" },
  { key: "callback", label: "متأجلة", flag: "callback_due" },
  { key: "interview", label: "مقابلات", status: "interview" },
  { key: "hired", label: "اشتغلوا", status: "hired" },
];

/** One-tap views over the leads list; every other filter stays in the filter bar below. */
export async function LeadQuickTabs({ f, path, view, tabs = AGENT_QUICK }: { f: LeadFilters; path: string; view: LeadsView; tabs?: Quick[] }) {
  const t = await getT();
  const current = tabs.find((q) => (q.status ?? undefined) === f.status && (q.flag ?? undefined) === f.flag)?.key;
  return (
    <nav aria-label={t("عرض سريع")} className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1">
      {tabs.map((q) => {
        const qs = filtersToQuery({ ...f, status: q.status, flag: q.flag, page: 1 });
        const href = `${path}?${qs}${view === "board" ? `${qs ? "&" : ""}view=board` : ""}`;
        const on = q.key === current;
        return (
          <Link
            key={q.key}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition ${on ? "bg-white text-(--fg) shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            {t(q.label)}
          </Link>
        );
      })}
    </nav>
  );
}
