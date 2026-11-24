import { Inbox, MessageCircle, Settings2, X } from "lucide-react";
import { addCompanyKeyword, assignFacebookLead, assignLineCrmLead, assignLineCrmMany, deleteCompanyKeyword, dismissFacebookLead, dismissLineCrmLead, saveAutoAssign } from "@/app/actions/integrations";
import { getConfig } from "@/lib/app-config";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Field = { name?: string; values?: string[] };
type Payload = { field_data?: Field[]; campaign_name?: string; ad_name?: string } | null;

const NAME = new Set(["full_name", "full name", "الاسم", "الاسم بالكامل"]);
const PHONE = new Set(["phone_number", "phone", "رقم الهاتف", "الموبايل"]);

/** Pulls the name, phone and the other answers out of a Graph API lead. */
function readLead(p: Payload) {
  let name = "";
  let first = "";
  let last = "";
  let phone = "";
  const answers: [string, string][] = [];
  for (const f of p?.field_data ?? []) {
    const key = (f.name ?? "").toLowerCase();
    const value = (f.values ?? []).join("، ");
    if (NAME.has(key)) name = value;
    else if (key === "first_name") first = value;
    else if (key === "last_name") last = value;
    else if (PHONE.has(key)) phone = value;
    else if (value) answers.push([f.name ?? "", value]);
  }
  return { name: name || [first, last].filter(Boolean).join(" "), phone, answers };
}

type LineLead = { id?: string; name?: string; phone?: string; source?: string; ad_name?: string; campaign_name?: string; owner_name?: string; notes?: string };
type Company = { id: string; name: string; slug: string | null; keywords: string[] };

/** The company whose name, code or keyword appears in the campaign or ad name, if exactly one does (same rule as company_guess in the database). */
function guessCompany(companies: Company[], text: string) {
  const hay = text.toLowerCase();
  const has = (k: string | null, min: number) => Boolean(k && k.trim().length >= min && hay.includes(k.trim().toLowerCase()));
  const hits = companies.filter((c) => has(c.name, 3) || has(c.slug, 3) || c.keywords.some((k) => has(k, 2)));
  return hits.length === 1 ? hits[0].id : "";
}

function CompanySelect({ companies, value, placeholder }: { companies: Company[]; value: string; placeholder: string }) {
  return (
    <select name="company_id" defaultValue={value} className="input min-w-40 flex-1" required>
      <option value="" disabled>{placeholder}</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/** Leads waiting for a company: Facebook form leads from unlinked forms, and LineCRM (WhatsApp ads) leads. */
export default async function FacebookLeadsPage() {
  const t = await getT();
  const me = await requireRole("admin", "manager");
  const db = await createClient();
  const [eventsRes, companiesRes, formsRes, lineRes, keywordsRes, cfg] = await Promise.all([
    db.from("meta_lead_events").select("leadgen_id, form_id, payload, created_at").eq("status", "unmapped").order("created_at", { ascending: false }).limit(200),
    db.from("companies").select("id, name, slug").eq("is_active", true).order("name"),
    db.from("meta_lead_forms").select("form_id"),
    db.from("linecrm_events").select("id, details, created_at").eq("status", "queued").order("created_at", { ascending: false }).limit(300),
    db.from("company_keywords").select("id, company_id, keyword").order("created_at"),
    getConfig(),
  ]);
  const keywords = keywordsRes.data ?? [];
  const companies = ((companiesRes.data ?? []) as Omit<Company, "keywords">[]).map((c) => ({ ...c, keywords: keywords.filter((k) => k.company_id === c.id).map((k) => k.keyword) }));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const autoOn = cfg.auto_assign_by_campaign === "1";
  const linked = new Set((formsRes.data ?? []).map((f) => f.form_id));
  const events = (eventsRes.data ?? []).filter((e) => !linked.has(e.form_id ?? ""));
  const lineLeads = (lineRes.data ?? []).map((e) => {
    const d = e.details as { data?: LineLead } | LineLead | null;
    return { id: e.id, created_at: e.created_at, lead: ((d && "data" in d ? d.data : d) ?? {}) as LineLead };
  });
  // One group per campaign, biggest first, so a whole campaign can go to one company at once.
  const groups = [...lineLeads.reduce((m, l) => {
    const key = l.lead.campaign_name || l.lead.ad_name || "";
    m.set(key, [...(m.get(key) ?? []), l]);
    return m;
  }, new Map<string, typeof lineLeads>())].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <PageHeader
        title={t("ليدز مستنية توزيع")}
        subtitle={t("ليدز الواتساب من LineCRM وليدز الفورمز اللي مش مربوطة بشركة — اختار لكل ليد الشركة بتاعته، وهيتوزع على أجنت أوتوماتيك")}
      />
      <details className="card mb-6">
        <summary className="flex cursor-pointer items-center gap-2 font-bold"><Settings2 size={18} className="text-zinc-500" /> {t("التوزيع الأوتوماتيك وكلمات الشركات")}
          <span className={`badge ms-auto ${autoOn ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>{autoOn ? t("الأوتوماتيك شغّال") : t("الأوتوماتيك مقفول")}</span>
        </summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p className="text-zinc-500">{t("لو اسم شركة واحدة بس (أو كلمة من كلماتها) مكتوب في اسم الحملة أو الإعلان، الليد يدخل عليها على طول ويتوزع من غير ما يستنى هنا. لو مفيش أو أكتر من شركة، يستنى هنا.")}</p>
            {me.role === "admin" ? (
              <StateForm action={saveAutoAssign} className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" name="enabled" defaultChecked={autoOn} className="size-4 accent-brand-600" /> {t("وزّع أوتوماتيك لما الشركة تتعرف من اسم الحملة")}
                </label>
              </StateForm>
            ) : (
              <p className="text-xs text-zinc-400">{t("الأدمن بس يقدر يشغّل أو يقفل الأوتوماتيك")}</p>
            )}
          </div>
          <div className="space-y-3 text-sm">
            <p className="text-zinc-500">{t("كلمات إضافية لكل شركة (زي «بريد فاست»): لو الكلمة موجودة في اسم الحملة أو الإعلان، الشركة تتعرف.")}</p>
            <StateForm action={addCompanyKeyword} submitLabel={t("ضيف الكلمة")} resetOnSuccess className="flex flex-wrap items-center gap-2">
              <CompanySelect companies={companies} value="" placeholder={t("الشركة")} />
              <input name="keyword" className="input min-w-40 flex-1" placeholder={t("الكلمة")} required minLength={2} maxLength={60} />
            </StateForm>
            {keywords.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <li key={k.id} className="badge flex items-center gap-1 bg-zinc-100 text-zinc-700">
                    <span>{companyName.get(k.company_id) ?? "—"}: {k.keyword}</span>
                    <form action={deleteCompanyKeyword}>
                      <input type="hidden" name="id" value={k.id} />
                      <button aria-label={t("امسح")} className="text-zinc-400 hover:text-rose-600"><X size={12} /></button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>
      {events.length === 0 && lineLeads.length === 0 && <Empty>{t("مفيش ليدز مستنية دلوقتي")}</Empty>}

      {lineLeads.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><MessageCircle size={18} className="text-emerald-600" /> {t("من إعلانات الواتساب (LineCRM)")} <span className="num text-sm text-zinc-500">({lineLeads.length})</span></h2>
          <div className="space-y-6">
            {groups.map(([campaign, items]) => {
              const guess = guessCompany(companies, `${items[0].lead.campaign_name ?? ""} ${items[0].lead.ad_name ?? ""}`);
              return (
                <div key={campaign || "—"} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-zinc-50 p-3">
                    <p className="min-w-0 flex-1 text-sm font-semibold">{campaign || t("من غير حملة")} <span className="num text-zinc-500">({items.length})</span></p>
                    {items.length > 1 && (
                      <StateForm action={assignLineCrmMany} submitLabel={t("دخّل الـ {0} كلهم", items.length)} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="event_ids" value={items.map((i) => i.id).join(",")} />
                        <CompanySelect companies={companies} value={guess} placeholder={t("الشركة")} />
                      </StateForm>
                    )}
                  </div>
              <ul className="grid gap-4 lg:grid-cols-2">
                {items.map(({ id, created_at, lead }) => (
              <li key={id} className="card space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{lead.name || t("من غير اسم")}</p>
                    <p className="num text-sm text-zinc-600" dir="ltr">{lead.phone || "—"}</p>
                  </div>
                  <span className="num text-xs text-zinc-400">{formatDate(created_at)}</span>
                </div>
                <dl className="grid gap-1 text-sm">
                  {[
                    [t("الإعلان"), lead.ad_name],
                    [t("الحملة"), lead.campaign_name],
                    [t("المسؤول في LineCRM"), lead.owner_name],
                    [t("أول رسالة"), lead.notes?.replace(/^whatsapp:\s*/, "")],
                  ].filter(([, v]) => v).map(([q, a]) => (
                    <div key={q} className="flex gap-2">
                      <dt className="text-zinc-500">{q}:</dt>
                      <dd className="font-medium">{a}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap items-start gap-2">
                  <StateForm action={assignLineCrmLead} submitLabel={t("دخّله على الشركة")} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="event_id" value={id} />
                    <CompanySelect companies={companies} value={guessCompany(companies, `${lead.campaign_name ?? ""} ${lead.ad_name ?? ""}`)} placeholder={t("الشركة")} />
                  </StateForm>
                  <form action={dismissLineCrmLead}>
                    <input type="hidden" name="event_id" value={id} />
                    <button className="btn-ghost text-sm text-zinc-500">{t("تجاهل")}</button>
                  </form>
                </div>
              </li>
            ))}
                </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Inbox size={18} className="text-sky-600" /> {t("من فورمز فيسبوك")} <span className="num text-sm text-zinc-500">({events.length})</span></h2>
        <ul className="grid gap-4 lg:grid-cols-2">
          {events.map((e) => {
            const lead = readLead(e.payload as Payload);
            const p = e.payload as Payload;
            return (
              <li key={e.leadgen_id} className="card space-y-3">
                <div className="flex items-start gap-3">
                  <Inbox size={18} className="mt-1 text-sky-600" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{lead.name || t("من غير اسم")}</p>
                    <p className="num text-sm text-zinc-600" dir="ltr">{lead.phone || "—"}</p>
                  </div>
                  <span className="num text-xs text-zinc-400">{formatDate(e.created_at)}</span>
                </div>
                {lead.answers.length > 0 && (
                  <dl className="grid gap-1 text-sm">
                    {lead.answers.slice(0, 6).map(([q, a]) => (
                      <div key={q} className="flex gap-2">
                        <dt className="text-zinc-500">{q}:</dt>
                        <dd className="font-medium">{a}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="text-xs text-zinc-400">
                  {t("فورم")} <span className="num" dir="ltr">{e.form_id}</span>
                  {p?.campaign_name ? ` · ${p.campaign_name}` : ""}
                  {p?.ad_name ? ` · ${p.ad_name}` : ""}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  <StateForm action={assignFacebookLead} submitLabel={t("دخّله على الشركة")} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="leadgen_id" value={e.leadgen_id} />
                    <CompanySelect companies={companies} value="" placeholder={t("الشركة")} />
                  </StateForm>
                  <form action={dismissFacebookLead}>
                    <input type="hidden" name="leadgen_id" value={e.leadgen_id} />
                    <button className="btn-ghost text-sm text-zinc-500">{t("تجاهل")}</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        </section>
      )}
    </>
  );
}
