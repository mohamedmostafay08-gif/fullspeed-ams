import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { LeadsTable, type LeadRow } from "@/components/leads-table";
import { requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { filtersToQuery, queryLeads, readFilters } from "@/lib/lead-query";
import { LEAD_STATUS_LABELS } from "@/lib/types";

const PAGE_SIZE = 50;

export default async function AgentLeadsPage({ searchParams }: PageProps<"/agent/leads">) {
  const profile = await requireRole("agent");
  const f = { ...readFilters(await searchParams), agent: profile.id };
  const [companies, { data: leads, count }] = await Promise.all([
    getAssignedCompanies(profile.id),
    queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const base = { ...f, agent: undefined };

  return (
    <>
      <PageHeader title="الليدز بتاعتي" subtitle={`${count ?? 0} ليد`}>
        <Link href="/agent/leads/new" className="btn-primary">+ ليد جديد</Link>
      </PageHeader>
      <form className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input name="q" defaultValue={f.q} placeholder="اسم أو موبايل" className="input" />
        <select name="company" defaultValue={f.company ?? ""} className="input">
          <option value="">كل الشركات</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="input">
          <option value="">كل الحالات</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" name="from" defaultValue={f.from} className="input" aria-label="من" />
        <button className="btn-ghost">فلتر</button>
      </form>
      <section className="card">
        <LeadsTable leads={(leads ?? []) as LeadRow[]} basePath="/agent/leads" showAgent={false} />
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {f.page > 1 && <Link className="btn-ghost" href={`/agent/leads?${filtersToQuery(base, f.page - 1)}`}>السابق</Link>}
            <span className="text-zinc-500">صفحة {f.page} من {pages}</span>
            {f.page < pages && <Link className="btn-ghost" href={`/agent/leads?${filtersToQuery(base, f.page + 1)}`}>التالي</Link>}
          </div>
        )}
      </section>
    </>
  );
}
