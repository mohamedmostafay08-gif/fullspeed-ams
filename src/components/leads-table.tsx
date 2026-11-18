import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { LeadStatusSelect } from "@/components/live";
import { CompanyLogo, Empty, formatDate } from "@/components/ui";
import type { LeadStatus } from "@/lib/types";

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
const place = (l: LeadRow) =>
  [(l.governorates as { name_ar: string } | null)?.name_ar, (l.regions as { name_ar: string } | null)?.name_ar].filter(Boolean).join(" · ") || "—";

export function ContactButtons({ phone }: { phone: string }) {
  return (
    <span className="flex items-center gap-1">
      <a href={`tel:${phone}`} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-ink" aria-label="اتصال" title="اتصال">
        <Phone size={15} />
      </a>
      <a
        href={`https://wa.me/2${phone}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-600"
        aria-label="واتساب"
        title="واتساب"
      >
        <MessageCircle size={15} />
      </a>
    </span>
  );
}

export function LeadsTable({ leads, basePath, showAgent }: { leads: LeadRow[]; basePath: string; showAgent: boolean }) {
  if (leads.length === 0) return <Empty>مفيش ليدز بالفلتر ده</Empty>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>المتقدم</th>
              <th>الشركة</th>
              <th>المنطقة</th>
              {showAgent && <th>الأجنت</th>}
              <th>الحالة</th>
              <th>التاريخ</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const c = l.companies as Company;
              return (
                <tr key={l.id}>
                  <td>
                    <Link href={`${basePath}/${l.id}`} className="font-semibold hover:text-brand-700">{l.full_name}</Link>
                    <p className="num text-xs text-zinc-500" dir="ltr">{l.phone}</p>
                  </td>
                  <td>
                    <span className="flex items-center gap-2 whitespace-nowrap"><CompanyLogo name={c.name} src={c.logo_path} size={26} />{c.name}</span>
                  </td>
                  <td className="text-zinc-600">{place(l)}</td>
                  {showAgent && (
                    <td>{(l.agent as { full_name: string } | null)?.full_name ?? <span className="badge bg-rose-50 text-rose-700">غير معيّن</span>}</td>
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
                  <p className="text-xs text-zinc-500">{c.name} · {place(l)}</p>
                  {showAgent && <p className="text-xs text-zinc-500">{(l.agent as { full_name: string } | null)?.full_name ?? "غير معيّن"}</p>}
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
