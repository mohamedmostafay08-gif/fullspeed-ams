import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { LeadsBoard } from "@/components/leads-board";
import { LeadsTable, ViewToggle, type LeadRow } from "@/components/leads-table";
import { LiveRefresh } from "@/components/live";
import { LeadImport } from "@/components/lead-import";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { BOARD_LIMIT, filtersToQuery, queryLeads, readFilters, readView, toBoardLeads } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { LeadFilterForm } from "@/components/lead-filters";

const PAGE_SIZE = 50;

export default async function AdminLeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  const t = await getT();
  await requireRole(...STAFF);
  const sp = await searchParams;
  const f = readFilters(sp);
  const view = readView(sp);
  const supabase = await createClient();
  const locale = await getLocale();
  const [companies, { data: agents }, { data: leads, count }, { data: teams }, { data: govs }] = await Promise.all([
    getCompanies(),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").order("full_name"),
    view === "board" ? queryLeads(f, { limit: BOARD_LIMIT, offset: 0 }) : queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("governorates").select("id, name_ar, name_en").order("id"),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = filtersToQuery(f);

  return (
    <>
      <LiveRefresh channel="admin-leads" />
      <PageHeader title={t("الليدز")} subtitle={t("{0} ليد", count ?? 0)}>
        <ViewToggle base="/admin/leads" query={qs} view={view} />
        <div className="flex gap-2">
          <a href={`/admin/leads/export?${qs}`} className="btn-ghost">{t("تصدير Excel")}</a>
          <Link href="/admin/leads/new" className="btn-primary">{t("ليد جديد")}</Link>
        </div>
      </PageHeader>

      <LeadFilterForm
        f={f}
        view={view}
        path="/admin/leads"
        companies={companies.map((c) => ({ id: c.id, name: c.name, form_schema: c.form_schema }))}
        agents={(agents ?? []).map((a) => ({ id: a.id, name: a.full_name }))}
        teams={(teams ?? []).map((x) => ({ id: x.id, name: x.name }))}
        governorates={(govs ?? []).map((g) => ({ id: g.id, name: locale === "en" && g.name_en ? g.name_en : g.name_ar }))}
      />

      {view === "board" ? (
        <LeadsBoard leads={toBoardLeads((leads ?? []) as Parameters<typeof toBoardLeads>[0])} basePath="/admin/leads" showAgent={true} />
      ) : (
        <section className="card">
          <LeadsTable leads={(leads ?? []) as LeadRow[]} basePath="/admin/leads" showAgent />
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              {f.page > 1 && <Link className="btn-ghost" href={`/admin/leads?${filtersToQuery(f, f.page - 1)}`}>{t("السابق")}</Link>}
              <span className="text-zinc-500">{t("صفحة")} {f.page} {t("من")} {pages}</span>
              {f.page < pages && <Link className="btn-ghost" href={`/admin/leads?${filtersToQuery(f, f.page + 1)}`}>{t("التالي")}</Link>}
            </div>
          )}
        </section>
      )}

      <section className="card mt-6 max-w-3xl">
        <h2 className="mb-1 font-semibold">{t("استيراد ليدز من ملف (CSV)")}</h2>
        <p className="mb-3 text-xs text-zinc-500">
          {t("من Excel: احفظ الشيت كـ CSV UTF-8. لازم أول سطر فيه عمود")} <b>{t("الاسم")}</b> {t("وعمود")} <b>{t("الموبايل")}</b>{t("، وممكن كمان")} <b>{t("المحافظة")}</b> {t("و")}<b>{t("المنطقة")}</b>{t(". أي أعمدة تانية بتتحفظ مع الليد. الأرقام المكررة على نفس الشركة بتتشال.")}
        </p>
        <LeadImport companies={companies.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))} agents={agents ?? []} />
      </section>
    </>
  );
}
