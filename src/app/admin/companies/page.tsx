import Link from "next/link";
import { createCompany } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { CompanyLogo } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function CompaniesPage() {
  const t = await getT();
  const profile = await requireRole(...STAFF);
  const supabase = await createClient();
  const [{ data: companies }, { data: assignments }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_path, is_active, form_schema").order("name"),
    supabase.from("agent_companies").select("company_id"),
  ]);
  const agentCount = new Map<string, number>();
  for (const a of assignments ?? []) agentCount.set(a.company_id, (agentCount.get(a.company_id) ?? 0) + 1);

  return (
    <>
      <PageHeader title={t("الشركات")} subtitle={t("{0} شركة", companies?.length ?? 0)} />
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(companies ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/admin/companies/${c.id}`}
            className={`card lift flex items-center gap-3 ${c.is_active ? "" : "opacity-50"}`}
          >
            <CompanyLogo name={c.name} src={c.logo_path} size={52} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{c.name}</p>
              <p className="text-xs text-zinc-500">
                {agentCount.get(c.id) ?? 0} {t("أجنت ·")} {(c.form_schema as unknown[]).length} {t("حقل")}
                {!c.is_active && t(" · متوقفة")}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {profile.role === "admin" && (
        <section id="new" className="card mt-6 max-w-2xl scroll-mt-24">
          <h2 className="mb-3 font-semibold">{t("إضافة شركة جديدة")}</h2>
          <StateForm action={createCompany} className="grid gap-3 sm:grid-cols-2" submitLabel={t("إضافة")}>
            <div>
              <label className="label" htmlFor="name">{t("اسم الشركة")}</label>
              <input id="name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="logo">{t("اللوجو")}</label>
              <input id="logo" name="logo" type="file" accept="image/*" className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="description">{t("وصف / ملاحظات")}</label>
              <textarea id="description" name="description" rows={2} className="input" />
            </div>
          </StateForm>
        </section>
      )}
    </>
  );
}
