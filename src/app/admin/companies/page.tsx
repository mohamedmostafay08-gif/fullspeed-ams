import Link from "next/link";
import { createCompany } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { CompanyLogo } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function CompaniesPage() {
  const profile = await requireRole("admin", "team_leader");
  const supabase = await createClient();
  const [{ data: companies }, { data: assignments }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_path, is_active, form_schema").order("name"),
    supabase.from("agent_companies").select("company_id"),
  ]);
  const agentCount = new Map<string, number>();
  for (const a of assignments ?? []) agentCount.set(a.company_id, (agentCount.get(a.company_id) ?? 0) + 1);

  return (
    <>
      <PageHeader title="الشركات" subtitle={`${companies?.length ?? 0} شركة`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(companies ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/admin/companies/${c.id}`}
            className={`card flex items-center gap-3 transition hover:border-brand-500 ${c.is_active ? "" : "opacity-50"}`}
          >
            <CompanyLogo name={c.name} src={c.logo_path} size={52} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{c.name}</p>
              <p className="text-xs text-zinc-500">
                {agentCount.get(c.id) ?? 0} أجنت · {(c.form_schema as unknown[]).length} حقل
                {!c.is_active && " · متوقفة"}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {profile.role === "admin" && (
        <section className="card mt-6 max-w-2xl">
          <h2 className="mb-3 font-semibold">إضافة شركة جديدة</h2>
          <StateForm action={createCompany} className="grid gap-3 sm:grid-cols-2" submitLabel="إضافة">
            <div>
              <label className="label" htmlFor="name">اسم الشركة</label>
              <input id="name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="logo">اللوجو</label>
              <input id="logo" name="logo" type="file" accept="image/*" className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="description">وصف / ملاحظات</label>
              <textarea id="description" name="description" rows={2} className="input" />
            </div>
          </StateForm>
        </section>
      )}
    </>
  );
}
