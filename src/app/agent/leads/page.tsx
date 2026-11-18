import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { LeadsTable, type LeadRow } from "@/components/leads-table";
import { LiveRefresh } from "@/components/live";
import { requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { filtersToQuery, queryLeads, readFilters } from "@/lib/lead-query";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const PAGE_SIZE = 50;

export default async function AgentLeadsPage({ searchParams }: PageProps<"/agent/leads">) {
  const t = await getT();
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
      <LiveRefresh channel="agent-leads" />
      <PageHeader title={t("الليدز بتاعتي")} subtitle={t("{0} ليد", count ?? 0)}>
        <Link href="/agent/leads/new" className="btn-primary">{t("+ ليد جديد")}</Link>
      </PageHeader>
      <form className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input name="q" defaultValue={f.q} placeholder={t("اسم أو موبايل")} className="input" />
        <select name="company" defaultValue={f.company ?? ""} className="input">
          <option value="">{t("كل الشركات")}</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="input">
          <option value="">{t("كل الحالات")}</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <input type="date" name="from" defaultValue={f.from} className="input" aria-label={t("من")} />
        <button className="btn-ghost">{t("فلتر")}</button>
      </form>
      <section className="card">
        <LeadsTable leads={(leads ?? []) as LeadRow[]} basePath="/agent/leads" showAgent={false} />
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {f.page > 1 && <Link className="btn-ghost" href={`/agent/leads?${filtersToQuery(base, f.page - 1)}`}>{t("السابق")}</Link>}
            <span className="text-zinc-500">{t("صفحة")} {f.page} {t("من")} {pages}</span>
            {f.page < pages && <Link className="btn-ghost" href={`/agent/leads?${filtersToQuery(base, f.page + 1)}`}>{t("التالي")}</Link>}
          </div>
        )}
      </section>
    </>
  );
}
