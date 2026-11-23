import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { LeadsBoard } from "@/components/leads-board";
import { LeadsTable, ViewToggle, type LeadRow } from "@/components/leads-table";
import { LiveRefresh } from "@/components/live";
import { requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { BOARD_LIMIT, filtersToQuery, queryLeads, readFilters, readView, toBoardLeads } from "@/lib/lead-query";
import { getLocale, getT } from "@/lib/i18n/server";
import { LeadFilterForm } from "@/components/lead-filters";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export default async function AgentLeadsPage({ searchParams }: PageProps<"/agent/leads">) {
  const t = await getT();
  const profile = await requireRole("agent");
  const sp = await searchParams;
  const f = { ...readFilters(sp), agent: profile.id };
  const view = readView(sp);
  const locale = await getLocale();
  const supabase = await createClient();
  const [companies, { data: leads, count }, { data: govs }] = await Promise.all([
    getAssignedCompanies(profile.id),
    view === "board" ? queryLeads(f, { limit: BOARD_LIMIT, offset: 0 }) : queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
    supabase.from("governorates").select("id, name_ar, name_en").order("id"),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const base = { ...f, agent: undefined };

  return (
    <>
      <LiveRefresh channel="agent-leads" />
      <PageHeader title={t("الليدز بتاعتي")} subtitle={t("{0} ليد", count ?? 0)}>
        <ViewToggle base="/agent/leads" query={filtersToQuery(base)} view={view} />
        <Link href="/agent/leads/new" className="btn-primary">{t("+ ليد جديد")}</Link>
      </PageHeader>
      <LeadFilterForm
        f={base}
        view={view}
        path="/agent/leads"
        companies={companies.map((c) => ({ id: c.id, name: c.name, form_schema: c.form_schema }))}
        governorates={(govs ?? []).map((g) => ({ id: g.id, name: locale === "en" && g.name_en ? g.name_en : g.name_ar }))}
      />
      {view === "board" ? (
        <LeadsBoard leads={toBoardLeads((leads ?? []) as Parameters<typeof toBoardLeads>[0])} basePath="/agent/leads" showAgent={false} />
      ) : (
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
      )}
    </>
  );
}
