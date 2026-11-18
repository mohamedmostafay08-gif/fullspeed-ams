import Link from "next/link";
import { importLeads } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { LeadsTable, type LeadRow } from "@/components/leads-table";
import { LiveRefresh } from "@/components/live";
import { StateForm } from "@/components/state-form";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { filtersToQuery, queryLeads, readFilters } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS } from "@/lib/types";

const PAGE_SIZE = 50;

export default async function AdminLeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requireRole(...STAFF);
  const f = readFilters(await searchParams);
  const supabase = await createClient();
  const [companies, { data: agents }, { data: leads, count }] = await Promise.all([
    getCompanies(),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").order("full_name"),
    queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = filtersToQuery(f);

  return (
    <>
      <LiveRefresh channel="admin-leads" />
      <PageHeader title="الليدز" subtitle={`${count ?? 0} ليد`}>
        <div className="flex gap-2">
          <a href={`/admin/leads/export?${qs}`} className="btn-ghost">تصدير Excel</a>
          <Link href="/admin/leads/new" className="btn-primary">ليد جديد</Link>
        </div>
      </PageHeader>

      <form className="card mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <input name="q" defaultValue={f.q} placeholder="اسم أو موبايل" className="input lg:col-span-2" />
        <select name="company" defaultValue={f.company ?? ""} className="input">
          <option value="">كل الشركات</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="agent" defaultValue={f.agent ?? ""} className="input">
          <option value="">كل الأجنتس</option>
          <option value="none">غير معيّن</option>
          {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="input">
          <option value="">كل الحالات</option>
          {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" name="from" defaultValue={f.from} className="input" aria-label="من" />
        <div className="flex gap-2">
          <input type="date" name="to" defaultValue={f.to} className="input" aria-label="إلى" />
          <button className="btn-ghost">فلتر</button>
        </div>
      </form>

      <section className="card">
        <LeadsTable leads={(leads ?? []) as LeadRow[]} basePath="/admin/leads" showAgent />
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {f.page > 1 && <Link className="btn-ghost" href={`/admin/leads?${filtersToQuery(f, f.page - 1)}`}>السابق</Link>}
            <span className="text-zinc-500">صفحة {f.page} من {pages}</span>
            {f.page < pages && <Link className="btn-ghost" href={`/admin/leads?${filtersToQuery(f, f.page + 1)}`}>التالي</Link>}
          </div>
        )}
      </section>

      <section className="card mt-6 max-w-3xl">
        <h2 className="mb-1 font-semibold">استيراد ليدز من ملف (CSV)</h2>
        <p className="mb-3 text-xs text-zinc-500">
          من Excel: احفظ الشيت كـ CSV UTF-8. لازم أول سطر فيه عمود <b>الاسم</b> وعمود <b>الموبايل</b>، وممكن كمان <b>المحافظة</b> و<b>المنطقة</b>.
          أي أعمدة تانية بتتحفظ مع الليد. الأرقام المكررة على نفس الشركة بتتشال.
        </p>
        <StateForm action={importLeads} className="grid gap-3 sm:grid-cols-3" submitLabel="استيراد" resetOnSuccess>
          <select name="company_id" required className="input">
            <option value="">الشركة</option>
            {companies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="distribute" defaultValue="auto" className="input">
            <option value="auto">وزّع بالتساوي على أجنتس الشركة</option>
            <option value="none">من غير تعيين</option>
            {(agents ?? []).map((a) => <option key={a.id} value={a.id}>كلهم لـ {a.full_name}</option>)}
          </select>
          <input name="file" type="file" accept=".csv,text/csv" required className="input" />
        </StateForm>
      </section>
    </>
  );
}
