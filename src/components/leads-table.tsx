import Link from "next/link";
import { CompanyLogo, Empty, StatusBadge, formatDate } from "@/components/ui";
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

export function LeadsTable({ leads, basePath, showAgent }: { leads: LeadRow[]; basePath: string; showAgent: boolean }) {
  if (leads.length === 0) return <Empty>مفيش ليدز بالفلتر ده</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>المتقدم</th>
            <th>الشركة</th>
            <th>المنطقة</th>
            {showAgent && <th>الأجنت</th>}
            <th>الحالة</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const c = l.companies as { name: string; logo_path: string | null };
            return (
              <tr key={l.id} className="hover:bg-zinc-50">
                <td>
                  <Link href={`${basePath}/${l.id}`} className="font-medium hover:text-brand-700">{l.full_name}</Link>
                  <p className="text-xs text-zinc-500" dir="ltr">{l.phone}</p>
                </td>
                <td>
                  <span className="flex items-center gap-2 whitespace-nowrap"><CompanyLogo name={c.name} src={c.logo_path} size={24} />{c.name}</span>
                </td>
                <td className="text-zinc-600">
                  {(l.governorates as { name_ar: string } | null)?.name_ar ?? "—"}
                  {(l.regions as { name_ar: string } | null) && ` / ${(l.regions as { name_ar: string }).name_ar}`}
                </td>
                {showAgent && <td>{(l.agent as { full_name: string } | null)?.full_name ?? <span className="text-rose-600">غير معيّن</span>}</td>}
                <td><StatusBadge status={l.status as LeadStatus} /></td>
                <td className="whitespace-nowrap text-xs text-zinc-500">{formatDate(l.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
