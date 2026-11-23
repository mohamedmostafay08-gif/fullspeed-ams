import { Inbox } from "lucide-react";
import { assignFacebookLead, dismissFacebookLead } from "@/app/actions/integrations";
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

/** Leads from lead-ad forms that aren't linked to a company: an admin picks the company for each one. */
export default async function FacebookLeadsPage() {
  const t = await getT();
  await requireRole("admin", "manager");
  const db = await createClient();
  const [eventsRes, companiesRes, formsRes] = await Promise.all([
    db.from("meta_lead_events").select("leadgen_id, form_id, payload, created_at").eq("status", "unmapped").order("created_at", { ascending: false }).limit(200),
    db.from("companies").select("id, name").eq("is_active", true).order("name"),
    db.from("meta_lead_forms").select("form_id"),
  ]);
  const companies = companiesRes.data ?? [];
  const linked = new Set((formsRes.data ?? []).map((f) => f.form_id));
  const events = (eventsRes.data ?? []).filter((e) => !linked.has(e.form_id ?? ""));

  return (
    <>
      <PageHeader
        title={t("ليدز فيسبوك مستنية توزيع")}
        subtitle={t("ليدز الفورمز اللي مش مربوطة بشركة — اختار لكل ليد الشركة بتاعته، وهيتوزع على أجنت أوتوماتيك")}
      />
      {events.length === 0 ? (
        <Empty>{t("مفيش ليدز مستنية دلوقتي")}</Empty>
      ) : (
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
                    <select name="company_id" defaultValue="" className="input min-w-40 flex-1" required>
                      <option value="" disabled>{t("الشركة")}</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
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
      )}
    </>
  );
}
