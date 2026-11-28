import Link from "next/link";
import { notFound } from "next/navigation";
import { createAnnouncement, updateCompany, saveCallScript, saveCompanyTerms } from "@/app/admin/actions";
import { CompanyTerms } from "@/components/company-terms";
import { hasTerms, type Terms } from "@/lib/terms";
import { PageHeader } from "@/components/app-shell";
import { PageTabs } from "@/components/sub-tabs";
import { FormBuilder } from "@/components/form-builder";
import { StateForm } from "@/components/state-form";
import { CompanyLogo, Empty, formatDate } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { getGeo } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FormField } from "@/lib/types";
import { getLocale, getT } from "@/lib/i18n/server";
import { placeName } from "@/lib/types";

const ANN_LABEL: Record<string, string> = { bonus: "بونص", rate: "تعريفة", info: "معلومة" };

export default async function CompanyPage({ params, searchParams }: PageProps<"/admin/companies/[id]">) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const profile = await requireRole(...STAFF);
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "form" || sp.tab === "setup" ? sp.tab : "offer";
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, slug, logo_path, description, form_schema, is_active, call_script, salary, order_price, working_hours, terms")
    .eq("id", id)
    .maybeSingle();
  if (!company) notFound();

  const [{ governorates }, hiringRes, annRes, agentsRes] = await Promise.all([
    getGeo(),
    supabase.from("company_governorates").select("governorate_id").eq("company_id", id),
    supabase.from("company_announcements").select("id, type, title, body, amount, valid_to, created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("agent_companies").select("profiles!agent_companies_agent_id_fkey(id, full_name)").eq("company_id", id),
  ]);
  const hiring = new Set((hiringRes.data ?? []).map((r) => r.governorate_id));
  const agents = (agentsRes.data ?? []).map((r) => r.profiles as unknown as { id: string; full_name: string } | null).filter(Boolean) as { id: string; full_name: string }[];
  const isAdmin = profile.role === "admin";
  const canEditTerms = isAdmin || profile.role === "manager";
  const terms = company as unknown as Terms;

  return (
    <>
      <PageHeader title={company.name} subtitle={company.is_active ? t("شغالة") : t("متوقفة")}>
        <CompanyLogo name={company.name} src={company.logo_path} size={56} />
      </PageHeader>

      <PageTabs path={`/admin/companies/${company.id}`} current={tab} tabs={[
        { key: "offer", label: t("العرض والبونص") },
        { key: "form", label: t("فورم التسجيل") },
        { key: "setup", label: t("البيانات والأجنتس") },
      ]} />

      {tab === "offer" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
          <section className="card">
            <h2 className="mb-1 font-semibold">{t("المرتب وشروط الشغل")}</h2>
            <p className="mb-3 text-xs text-zinc-500">{t("بتظهر للأجنت وهو بيكلم الكابتن، وعلى كارت الشركة في صفحته")}</p>
            {canEditTerms ? (
              <StateForm action={saveCompanyTerms} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="id" value={company.id} />
                <div>
                  <label className="label" htmlFor="salary">{t("المرتب")}</label>
                  <input id="salary" name="salary" maxLength={120} defaultValue={terms.salary ?? ""} placeholder={t("مثلاً: 8000 ج ثابت")} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="order_price">{t("سعر الأوردر")}</label>
                  <input id="order_price" name="order_price" maxLength={120} defaultValue={terms.order_price ?? ""} placeholder={t("مثلاً: 25 ج للأوردر")} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="working_hours">{t("عدد الساعات")}</label>
                  <input id="working_hours" name="working_hours" maxLength={120} defaultValue={terms.working_hours ?? ""} placeholder={t("مثلاً: 10 ساعات / 6 أيام")} className="input" />
                </div>
                <div className="sm:col-span-3">
                  <label className="label" htmlFor="terms">{t("شروط ومميزات تانية — كل سطر: العنوان: القيمة")}</label>
                  <textarea
                    id="terms"
                    name="terms"
                    rows={4}
                    defaultValue={(terms.terms ?? []).map((x) => `${x.label}: ${x.value}`).join("\n")}
                    placeholder={t("التأمين: بعد 3 شهور\nالبونص: 500 ج لو عدّيت 300 أوردر\nالسن: من 21 لـ 45")}
                    className="input text-sm leading-6"
                  />
                </div>
              </StateForm>
            ) : hasTerms(terms) ? (
              <CompanyTerms terms={terms} />
            ) : (
              <p className="text-sm text-zinc-400">{t("لسه متحددتش")}</p>
            )}
          </section>

          <section className="card">
            <h2 className="mb-1 font-semibold">{t("سكربت المكالمة")}</h2>
            <p className="mb-3 text-xs text-zinc-500">{t("بيظهر للأجنت وهو بيكلم المتقدم. سطر يبدأ بـ # = عنوان · سطر يبدأ بـ ؟ = سؤال يعلّم عليه · أي سطر تاني = نقطة يقولها.")}</p>
            {canEditTerms ? (
              <StateForm action={saveCallScript} className="space-y-3">
                <input type="hidden" name="id" value={company.id} />
                <textarea
                  name="call_script"
                  rows={9}
                  maxLength={4000}
                  defaultValue={company.call_script ?? ""}
                  className="input font-mono text-sm leading-6"
                  placeholder={"# البداية\nعرّف نفسك واسم الشركة\n؟ معاك موتوسيكل برخصة سارية؟\n؟ سنك كام؟\n# العرض\nالمرتب بيبدأ من … + بونص أسبوعي\n؟ تقدر تيجي المقابلة إمتى؟"}
                />
              </StateForm>
            ) : company.call_script ? (
              <p className="text-sm whitespace-pre-line text-zinc-700">{company.call_script}</p>
            ) : (
              <p className="text-sm text-zinc-400">{t("لسه مفيش سكربت")}</p>
            )}
          </section>
          </div>
          <div className="space-y-6">
          <section className="card">
            <h2 className="mb-1 font-semibold">{t("نشر بونص / تعريفة")}</h2>
            <p className="mb-3 text-xs text-zinc-500">{t("بيوصل إشعار فوري لكل الأجنتس المتعينين على")} {company.name} ({agents.length})</p>
            <StateForm action={createAnnouncement} className="space-y-3" submitLabel={t("نشر")} resetOnSuccess>
              <input type="hidden" name="company_id" value={company.id} />
              <select name="type" className="input">
                <option value="bonus">{t("بونص")}</option>
                <option value="rate">{t("تعريفة جديدة")}</option>
                <option value="info">{t("معلومة / تحديث")}</option>
              </select>
              <input name="title" required placeholder={t("العنوان (مثلاً: بونص 500 جنيه لكل كابتن)")} className="input" />
              <textarea name="body" rows={3} placeholder={t("التفاصيل والشروط")} className="input" />
              <div className="grid grid-cols-2 gap-2">
                <input name="amount" type="number" step="0.01" placeholder={t("المبلغ (ج.م)")} className="input" />
                <input name="valid_to" type="date" className="input" aria-label={t("ساري حتى")} />
              </div>
            </StateForm>
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold">{t("آخر الإعلانات")}</h2>
            {(annRes.data ?? []).length === 0 ? (
              <Empty>{t("مفيش")}</Empty>
            ) : (
              <ul className="space-y-3 text-sm">
                {(annRes.data ?? []).map((a) => (
                  <li key={a.id} className="rounded-lg bg-zinc-50 p-3">
                    <p className="font-semibold">
                      <span className="text-brand-700">{t(ANN_LABEL[a.type])}:</span> {a.title}
                      {a.amount != null && t(" — {0} ج.م", a.amount)}
                    </p>
                    {a.body && <p className="mt-1 text-zinc-600">{a.body}</p>}
                    <p className="mt-1 text-xs text-zinc-400">
                      {formatDate(a.created_at)}{a.valid_to && t(" · لحد {0}", a.valid_to)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>
        </div>
      )}

      {tab === "form" && (
        <div className="max-w-4xl">
          <section className="card">
            <h2 className="mb-3 font-semibold">{t("فورم التسجيل الخاص بالشركة")}</h2>
            {canEditTerms ? (
              <FormBuilder companyId={company.id} initial={company.form_schema as FormField[]} />
            ) : (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {(company.form_schema as FormField[]).map((f) => <li key={f.key}>{f.label}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "setup" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {isAdmin && (
            <div className="lg:col-span-2">
            <section className="card">
              <h2 className="mb-3 font-semibold">{t("بيانات الشركة ومناطق التعيين")}</h2>
              <StateForm action={updateCompany} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={company.id} />
                <input type="hidden" name="slug" value={company.slug} />
                <div>
                  <label className="label" htmlFor="name">{t("الاسم")}</label>
                  <input id="name" name="name" defaultValue={company.name} required className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="logo">{t("تغيير اللوجو")}</label>
                  <input id="logo" name="logo" type="file" accept="image/*" className="input" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="description">{t("ملاحظات / شروط الشركة")}</label>
                  <textarea id="description" name="description" defaultValue={company.description ?? ""} rows={3} className="input" />
                </div>
                <fieldset className="sm:col-span-2">
                  <legend className="label">{t("المحافظات اللي الشركة بتعيّن فيها")}</legend>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                    {governorates.map((g) => (
                      <label key={g.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="governorate_id" value={g.id} defaultChecked={hiring.has(g.id)} className="accent-brand-600" />
                        {placeName(g, locale)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="is_active" defaultChecked={company.is_active} className="accent-brand-600" /> {t("الشركة شغالة")}
                </label>
              </StateForm>
            </section>
            </div>
          )}
          <div>
          <section className="card">
            <h2 className="mb-3 font-semibold">{t("الأجنتس المتعينين")}</h2>
            {agents.length === 0 ? (
              <Empty>{t("مفيش — عيّن من صفحة الأجنت")}</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {agents.map((a) => (
                  <li key={a.id}><Link href={`/admin/agents/${a.id}`} className="hover:text-brand-700">{a.full_name}</Link></li>
                ))}
              </ul>
            )}
          </section>
          </div>
        </div>
      )}
    </>
  );
}
