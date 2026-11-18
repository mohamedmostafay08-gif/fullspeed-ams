import { MessageCircle, Trash2 } from "lucide-react";
import { addTemplate, deleteTemplate } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { PLACEHOLDERS, fillTemplate } from "@/lib/whatsapp";

const SAMPLE = { name: "محمد", company: "Talabat", agent: "سارة", interviewAt: "الأحد 11:00 ص", interviewPlace: "فرع مصر الجديدة" };

export default async function TemplatesPage() {
  const t = await getT();
  await requireRole(...STAFF);
  const supabase = await createClient();
  const [companies, { data }] = await Promise.all([
    getCompanies(true),
    supabase.from("whatsapp_templates").select("id, title, body, company_id, companies(name)").order("sort").order("created_at"),
  ]);
  const templates = data ?? [];

  return (
    <>
      <PageHeader title={t("قوالب واتساب")} subtitle={t("رسايل جاهزة الأجنت يبعتها بضغطة — الاسم والشركة بيتملوا لوحدهم")} />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card h-fit lg:col-span-2">
          <h2 className="card-title"><MessageCircle size={18} className="text-emerald-600" /> {t("قالب جديد")}</h2>
          <StateForm action={addTemplate} className="space-y-3" resetOnSuccess>
            <div>
              <label className="label" htmlFor="title">{t("اسم القالب")}</label>
              <input id="title" name="title" required maxLength={80} className="input" placeholder={t("مثلاً: تأكيد المقابلة")} />
            </div>
            <div>
              <label className="label" htmlFor="company_id">{t("الشركة (اختياري)")}</label>
              <select id="company_id" name="company_id" className="input">
                <option value="">{t("كل الشركات")}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="body">{t("الرسالة")}</label>
              <textarea id="body" name="body" required rows={5} maxLength={1500} className="input" />
              <p className="mt-1.5 flex flex-wrap gap-1 text-[11px] text-zinc-500">
                {t("متغيرات:")}
                {PLACEHOLDERS.map(([names]) => <code key={names[0]} className="rounded bg-zinc-100 px-1.5 py-0.5">{`{${names[0]}}`}</code>)}
              </p>
            </div>
          </StateForm>
        </section>

        <section className="space-y-3 lg:col-span-3">
          {templates.length === 0 && <Empty icon={MessageCircle}>{t("مفيش قوالب لسه")}</Empty>}
          {templates.map((tpl) => (
            <article key={tpl.id} className="card lift">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><MessageCircle size={17} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{tpl.title}</p>
                  <p className="text-xs text-zinc-500">{(tpl.companies as unknown as { name: string } | null)?.name ?? t("كل الشركات")}</p>
                </div>
                <form action={deleteTemplate}>
                  <input type="hidden" name="id" value={tpl.id} />
                  <button className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t("حذف")} title={t("حذف")}><Trash2 size={15} /></button>
                </form>
              </div>
              <p className="mt-3 rounded-2xl rounded-ss-sm bg-emerald-50 p-3 text-sm leading-6 whitespace-pre-line text-emerald-950 dark:text-emerald-900">{fillTemplate(tpl.body, SAMPLE)}</p>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
