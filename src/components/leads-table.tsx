import Link from "next/link";
import { Columns3, MessageCircle, Phone, Rows3 } from "lucide-react";
import { LeadStatusSelect } from "@/components/live";
import { SelectAllLeads } from "@/components/bulk-leads";
import { CompanyLogo, Empty, formatDate } from "@/components/ui";
import type { LeadStatus } from "@/lib/types";
import { getLocale, getT } from "@/lib/i18n/server";
import { placeName } from "@/lib/types";

export type LeadRow = {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  source: string;
  created_at: string;
  companies: unknown;
  governorates: unknown;
  regions: unknown;
  agent: unknown;
};

type Company = { name: string; logo_path: string | null };
const place = (l: LeadRow, locale: string) =>
  [placeName(l.governorates as { name_ar: string; name_en: string | null } | null, locale), (l.regions as { name_ar: string } | null)?.name_ar].filter(Boolean).join(" · ") || "—";

export async function ContactButtons({ phone }: { phone: string }) {
  const t = await getT();
  return (
    <span className="flex items-center gap-1">
      <a href={`tel:${phone}`} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-ink" aria-label={t("اتصال")} title={t("اتصال")}>
        <Phone size={15} />
      </a>
      <a
        href={`https://wa.me/2${phone}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-600"
        aria-label={t("واتساب")}
        title={t("واتساب")}
      >
        <MessageCircle size={15} />
      </a>
    </span>
  );
}

export async function LeadsTable({ leads, basePath, showAgent, selectable }: { leads: LeadRow[]; basePath: string; showAgent: boolean; selectable?: boolean }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (leads.length === 0) return <Empty>{t("مفيش ليدز بالفلتر ده")}</Empty>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              {selectable && <th className="w-8"><SelectAllLeads /></th>}
              <th>{t("المتقدم")}</th>
              <th>{t("الشركة")}</th>
              <th>{t("المنطقة")}</th>
              {showAgent && <th>{t("الأجنت")}</th>}
              <th>{t("الحالة")}</th>
              <th>{t("التاريخ")}</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const c = l.companies as Company;
              return (
                <tr key={l.id}>
                  {selectable && (
                    <td><input type="checkbox" name="ids" value={l.id} form="bulk-leads" aria-label={l.full_name} className="size-4 accent-brand-600" /></td>
                  )}
                  <td>
                    <Link href={`${basePath}/${l.id}`} className="font-semibold hover:text-brand-700">{l.full_name}</Link>
                    <p className="num text-xs text-zinc-500" dir="ltr">{l.phone}</p>
                  </td>
                  <td>
                    <span className="flex items-center gap-2 whitespace-nowrap"><CompanyLogo name={c.name} src={c.logo_path} size={26} />{c.name}</span>
                  </td>
                  <td className="text-zinc-600">{place(l, locale)}</td>
                  {showAgent && (
                    <td>{(l.agent as { full_name: string } | null)?.full_name ?? <span className="badge bg-rose-50 text-rose-700">{t("غير معيّن")}</span>}</td>
                  )}
                  <td><LeadStatusSelect id={l.id} status={l.status as LeadStatus} /></td>
                  <td className="whitespace-nowrap text-xs text-zinc-500">{formatDate(l.created_at)}</td>
                  <td><ContactButtons phone={l.phone} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {leads.map((l) => {
          const c = l.companies as Company;
          return (
            <li key={l.id} className="rounded-2xl border border-zinc-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <CompanyLogo name={c.name} src={c.logo_path} size={36} />
                <div className="min-w-0 flex-1">
                  <Link href={`${basePath}/${l.id}`} className="block truncate font-semibold">{l.full_name}</Link>
                  <p className="text-xs text-zinc-500">{c.name} · {place(l, locale)}</p>
                  {showAgent && <p className="text-xs text-zinc-500">{(l.agent as { full_name: string } | null)?.full_name ?? t("غير معيّن")}</p>}
                </div>
                <ContactButtons phone={l.phone} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <LeadStatusSelect id={l.id} status={l.status as LeadStatus} />
                <span className="text-[11px] text-zinc-400">{formatDate(l.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Table ⇄ board switch that keeps the current filters. */
export async function ViewToggle({ base, query, view }: { base: string; query: string; view: "table" | "board" }) {
  const t = await getT();
  const href = (v: string) => `${base}?${[query, v === "board" ? "view=board" : ""].filter(Boolean).join("&")}`;
  const cls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${active ? "bg-ink text-white dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-ink"}`;
  return (
    <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1" role="tablist">
      <Link href={href("table")} className={cls(view === "table")} role="tab" aria-selected={view === "table"}>
        <Rows3 size={14} /> {t("جدول")}
      </Link>
      <Link href={href("board")} className={cls(view === "board")} role="tab" aria-selected={view === "board"}>
        <Columns3 size={14} /> {t("لوحة")}
      </Link>
    </div>
  );
}
