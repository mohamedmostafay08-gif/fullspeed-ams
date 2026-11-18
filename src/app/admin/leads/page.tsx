import Link from "next/link";
import { importLeads } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { LeadsBoard } from "@/components/leads-board";
import { LeadsTable, ViewToggle, type LeadRow } from "@/components/leads-table";
import { LiveRefresh } from "@/components/live";
import { StateForm } from "@/components/state-form";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { BOARD_LIMIT, filtersToQuery, queryLeads, readFilters, readView, toBoardLeads } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const PAGE_SIZE = 50;

export default async function AdminLeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  const t = await getT();
  await requireRole(...STAFF);
  const sp = await searchParams;
  const f = readFilters(sp);
  const view = readView(sp);
  const supabase = await createClient();
  const [companies, { data: agents }, { data: leads, count }] = await Promise.all([
    getCompanies(),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").order("full_name"),
    view === "board" ? queryLeads(f, { limit: BOARD_LIMIT, offset: 0 }) : queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
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

      <form className="card mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {view === "board" && <input type="hidden" name="view" value="board" />}
        <input name="q" defaultValue={f.q} placeholder={t("اسم أو موبايل")} className="input lg:col-span-2" />
        <select name="company" defaultValue={f.company ?? ""} className="input">
          <option value="">{t("كل الشركات")}</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="agent" defaultValue={f.agent ?? ""} className="input">
          <option value="">{t("كل الأجنتس")}</option>
          <option value="none">{t("غير معيّن")}</option>
          {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="input">
          <option value="">{t("كل الحالات")}</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <input type="date" name="from" defaultValue={f.from} className="input" aria-label={t("من")} />
        <div className="flex gap-2">
          <input type="date" name="to" defaultValue={f.to} className="input" aria-label={t("إلى")} />
          <button className="btn-ghost">{t("فلتر")}</button>
        </div>
      </form>

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
        <StateForm action={importLeads} className="grid gap-3 sm:grid-cols-3" submitLabel={t("استيراد")} resetOnSuccess>
          <select name="company_id" required className="input">
            <option value="">{t("الشركة")}</option>
            {companies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="distribute" defaultValue="auto" className="input">
            <option value="auto">{t("وزّع بالتساوي على أجنتس الشركة")}</option>
            <option value="none">{t("من غير تعيين")}</option>
            {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{t("كلهم لـ")} {a.full_name}</option>)}
          </select>
          <input name="file" type="file" accept=".csv,text/csv" required className="input" />
        </StateForm>
      </section>
    </>
  );
}
