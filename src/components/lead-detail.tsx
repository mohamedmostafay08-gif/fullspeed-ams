import { notFound } from "next/navigation";
import { Ban, CalendarClock, Clock, PhoneCall, ShieldAlert, X } from "lucide-react";
import { clearSchedule, scheduleLead, setHireStage, updateLead } from "@/app/actions/leads";
import { addToBlacklist } from "@/app/admin/actions";
import { CallPanel } from "@/components/call-panel";
import { CallScript } from "@/components/call-script";
import { CompanyTerms } from "@/components/company-terms";
import type { Terms } from "@/lib/terms";
import { CallButton } from "@/components/call-timer";
import { LeadDocuments } from "@/components/lead-documents";
import { StateForm } from "@/components/state-form";
import { CompanyLogo, StatusBadge, formatDate } from "@/components/ui";
import { WhatsAppMenu } from "@/components/whatsapp-menu";
import { WaChat } from "@/components/wa-chat";
import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { formatFieldValue } from "@/lib/forms";
import { getLocale, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cairoDateTime, toCairoLocal } from "@/lib/time";
import { LEAD_STATUS_LABELS, placeName, type FormField, type LeadStatus } from "@/lib/types";
import { templatesFor, type Template } from "@/lib/whatsapp";

export async function LeadDetail({ id, staff }: { id: string; staff: boolean }) {
  const [t, locale, me] = await Promise.all([getT(), getLocale(), getProfile()]);
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, full_name, phone, status, notes, source, form_data, created_at, hired_at, first_order_at, active7_at, active30_at, left_at, left_reason, agent_id, company_id, attempts, last_contact_at, callback_at, interview_at, interview_place, companies(name, logo_path, form_schema, call_script, salary, order_price, working_hours, terms), governorates(name_ar, name_en), regions(name_ar), agent:profiles!leads_agent_id_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!lead || !me) notFound();

  const company = lead.companies as unknown as { name: string; logo_path: string | null; form_schema: FormField[]; call_script: string | null } & Terms;
  const agent = lead.agent as unknown as { full_name: string } | null;
  const formData = (lead.form_data ?? {}) as Record<string, unknown>;
  const schemaKeys = new Set(company.form_schema.map((f) => f.key));
  const extraKeys = Object.keys(formData).filter((k) => !schemaKeys.has(k));
  const closed = lead.status === "hired" || lead.status === "rejected";

  const [{ data: activity }, agentsRes, { data: banned }, tplRes] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("id, from_status, to_status, note, created_at, actor:profiles(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    staff
      ? supabase.from("agent_companies").select("profiles!agent_companies_agent_id_fkey(id, full_name, is_active)").eq("company_id", lead.company_id)
      : Promise.resolve({ data: null }),
    supabase.rpc("blacklist_reason", { p_phone: lead.phone }),
    supabase.from("whatsapp_templates").select("id, title, body, company_id").order("sort").order("created_at"),
  ]);
  const agents = ((agentsRes.data ?? []) as unknown as { profiles: { id: string; full_name: string; is_active: boolean } | null }[])
    .map((r) => r.profiles)
    .filter((p): p is { id: string; full_name: string; is_active: boolean } => Boolean(p?.is_active));
  // Keep the current agent selectable even if they left the company, so saving doesn't unassign the lead.
  if (lead.agent_id && !agents.some((a) => a.id === lead.agent_id)) {
    agents.unshift({ id: lead.agent_id, full_name: agent?.full_name ?? t("الأجنت الحالي"), is_active: true });
  }
  const templates = templatesFor((tplRes.data ?? []) as Template[], lead.company_id);
  const vars = {
    name: lead.full_name.split(" ")[0],
    company: company.name,
    agent: (agent?.full_name ?? me.full_name).split(" ")[0],
    interviewAt: lead.interview_at ? cairoDateTime(lead.interview_at, "ar") : undefined,
    interviewPlace: lead.interview_place ?? undefined,
  };
  const callbackDue = lead.callback_at && new Date(lead.callback_at) <= new Date();

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {banned && (
          <p role="alert" className="flex items-start gap-2 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-800 ring-1 ring-rose-200">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" /> {t("الرقم ده في البلاك ليست — {0}", banned)}
          </p>
        )}

        <section className="card">
          <div className="flex flex-wrap items-center gap-3">
            <CompanyLogo name={company.name} src={company.logo_path} size={48} />
            <div className="flex-1">
              <h1 className="text-xl font-bold">{lead.full_name}</h1>
              <p className="text-sm text-zinc-500">{company.name}</p>
            </div>
            <StatusBadge status={lead.status as LeadStatus} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <CallButton leadId={lead.id} name={lead.full_name} phone={lead.phone} className="btn-primary">
              <PhoneCall size={17} /> <span dir="ltr" className="num">{lead.phone}</span>
            </CallButton>
            <WhatsAppMenu leadId={lead.id} phone={lead.phone} templates={templates} vars={vars} />
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <Row label={t("المحافظة / المنطقة")}>
              {placeName(lead.governorates as unknown as { name_ar: string; name_en: string | null } | null, locale) ?? "—"} / {(lead.regions as unknown as { name_ar: string } | null)?.name_ar ?? "—"}
            </Row>
            <Row label={t("الأجنت")}>{agent?.full_name ?? t("غير معيّن")}</Row>
            <Row label={t("المصدر")}>{lead.source}</Row>
            <Row label={t("تاريخ التسجيل")}>{formatDate(lead.created_at)}</Row>
            <Row label={t("محاولات الاتصال")}><span className="num">{lead.attempts}</span>{lead.last_contact_at && <span className="text-xs text-zinc-500"> · {formatDate(lead.last_contact_at)}</span>}</Row>
            {lead.hired_at && <Row label={t("تاريخ التعيين")}>{formatDate(lead.hired_at)}</Row>}
            {company.form_schema.map((f) => (
              <Row key={f.key} label={f.label}>{formatFieldValue(f, formData[f.key])}</Row>
            ))}
            {extraKeys.map((k) => (
              <Row key={k} label={k}>{formatFieldValue(undefined, formData[k])}</Row>
            ))}
          </dl>
        </section>

        {lead.status === "hired" && (
          <section className="card">
            <h2 className="card-title">🛵 {t("بعد التعيين")}</h2>
            <p className="mb-3 text-sm text-zinc-500">{t("الكابتن اللي اتعين لازم ينزل الشغل ويكمّل — علّم كل مرحلة لما تتأكد منها. السيستم هيفكّرك.")}</p>
            <ol className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
              {[
                [t("اتعين"), lead.hired_at],
                [t("نزل أول أوردر"), lead.first_order_at],
                [t("كمّل 7 أيام"), lead.active7_at],
                [t("كمّل 30 يوم"), lead.active30_at],
              ].map(([label, at]) => (
                <li key={label as string} className={`rounded-xl p-2 ${at ? "bg-emerald-50 text-emerald-800" : "bg-zinc-50 text-zinc-500"}`}>
                  <p className="font-semibold">{at ? "✅" : "⏳"} {label}</p>
                  <p className="num text-xs">{at ? formatDate(at as string) : "—"}</p>
                </li>
              ))}
            </ol>
            {lead.left_at ? (
              <p className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">🚪 {t("ساب الشغل")} · {formatDate(lead.left_at)}{lead.left_reason ? ` — ${lead.left_reason}` : ""}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!lead.first_order_at && (
                <StateForm action={setHireStage} submitLabel={t("🛵 نزل أول أوردر")}>
                  <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value="first_order" />
                </StateForm>
              )}
              {lead.first_order_at && !lead.active7_at && (
                <StateForm action={setHireStage} submitLabel={t("✅ كمّل 7 أيام")}>
                  <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value="active7" />
                </StateForm>
              )}
              {lead.active7_at && !lead.active30_at && (
                <StateForm action={setHireStage} submitLabel={t("🏆 كمّل 30 يوم")}>
                  <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value="active30" />
                </StateForm>
              )}
            </div>
            {!lead.left_at && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-zinc-500">🚪 {t("ساب الشغل؟")}</summary>
                <StateForm action={setHireStage} submitLabel={t("سجّل إنه ساب")} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={lead.id} /><input type="hidden" name="stage" value="left" />
                  <input name="reason" className="input min-w-48 flex-1" placeholder={t("السبب (اختياري)")} maxLength={200} />
                </StateForm>
              </details>
            )}
          </section>
        )}

        {!closed && (
          <section className="card">
            <div className="mb-4 space-y-3"><CompanyTerms terms={company} /><CallScript script={company.call_script} defaultOpen={false} /></div>
            <h2 className="card-title"><PhoneCall size={18} className="text-brand-600" /> {t("نتيجة المكالمة")}</h2>
            <CallPanel leadId={lead.id} />
          </section>
        )}

        <section className="card grid gap-5 md:grid-cols-2">
          <div>
            <h2 className="card-title"><Clock size={18} className="text-amber-500" /> {t("معاد المكالمة الجاية")}</h2>
            {lead.callback_at && (
              <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${callbackDue ? "bg-amber-100 text-amber-900" : "bg-zinc-50"}`}>
                <span className="flex-1">{cairoDateTime(lead.callback_at, locale)}{callbackDue && ` · ${t("جه معادها")}`}</span>
                <form action={clearSchedule}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="kind" value="clear_callback" />
                  <button className="rounded-lg p-1 text-zinc-500 hover:bg-white" aria-label={t("إلغاء")} title={t("إلغاء")}><X size={15} /></button>
                </form>
              </div>
            )}
            <StateForm action={scheduleLead} className="space-y-2" submitLabel={lead.callback_at ? t("غيّر المعاد") : t("حدد معاد")}>
              <input type="hidden" name="id" value={lead.id} />
              <input type="hidden" name="kind" value="callback" />
              <input type="datetime-local" name="at" required defaultValue={lead.callback_at ? toCairoLocal(lead.callback_at) : ""} className="input" aria-label={t("معاد المكالمة")} />
            </StateForm>
          </div>
          <div>
            <h2 className="card-title"><CalendarClock size={18} className="text-violet-500" /> {t("المقابلة")}</h2>
            {lead.interview_at && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900">
                <span className="flex-1">{cairoDateTime(lead.interview_at, locale)}{lead.interview_place && ` · ${lead.interview_place}`}</span>
                <form action={clearSchedule}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="kind" value="clear_interview" />
                  <button className="rounded-lg p-1 text-violet-700 hover:bg-white" aria-label={t("إلغاء")} title={t("إلغاء")}><X size={15} /></button>
                </form>
              </div>
            )}
            {closed ? (
              // A hired or rejected lead is closed: booking an interview would undo the hire.
              <p className="text-sm text-zinc-500">{t("الليد ده مقفول ({0}) — مفيش مقابلات جديدة.", t(LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS]))}</p>
            ) : (
              <StateForm action={scheduleLead} className="space-y-2" submitLabel={lead.interview_at ? t("غيّر المعاد") : t("حدد مقابلة")}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="kind" value="interview" />
                <input type="datetime-local" name="at" required defaultValue={lead.interview_at ? toCairoLocal(lead.interview_at) : ""} className="input" aria-label={t("معاد المقابلة")} />
                <input name="place" defaultValue={lead.interview_place ?? ""} placeholder={t("مكان المقابلة")} className="input" maxLength={200} />
              </StateForm>
            )}
          </div>
        </section>

        <LeadDocuments leadId={lead.id} userId={me.id} staff={staff} />

        <form action={updateLead} className="card space-y-3">
          <input type="hidden" name="id" value={lead.id} />
          <h2 className="font-semibold">{t("تحديث الحالة")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="status">{t("الحالة")}</label>
              <select id="status" name="status" defaultValue={lead.status} className="input">
                {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{t(l)}</option>
                ))}
              </select>
            </div>
            {staff && (
              <div>
                <label className="label" htmlFor="agent_id">{t("تحويل لأجنت")}</label>
                <select id="agent_id" name="agent_id" defaultValue={lead.agent_id ?? ""} className="input">
                  <option value="">{t("بدون")}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="notes">{t("ملاحظات")}</label>
            <textarea id="notes" name="notes" defaultValue={lead.notes ?? ""} rows={3} className="input" />
          </div>
          <button className="btn-primary">{t("حفظ")}</button>
        </form>

        {staff && !banned && (
          <details className="card group">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-rose-700">
              <Ban size={18} /> {t("حظر الرقم (بلاك ليست)")}
            </summary>
            <p className="mt-2 text-xs text-zinc-500">{t("الرقم مش هيقدر يتسجل تاني على أي شركة، وكل الليدز المفتوحة بيه هتتقفل كمرفوضة.")}</p>
            <StateForm action={addToBlacklist} className="mt-3 flex flex-wrap gap-2" submitLabel={t("احظر الرقم")}>
              <input type="hidden" name="lead_id" value={lead.id} />
              <input type="hidden" name="phone" value={lead.phone} />
              <input type="hidden" name="full_name" value={lead.full_name} />
              <input name="reason" required placeholder={t("السبب (مثلاً: نصب / بيانات مزورة)")} className="input min-w-60 flex-1" maxLength={300} />
            </StateForm>
          </details>
        )}
      </div>

      <div className="space-y-5">
      <section className="card h-fit">
        <h2 className="card-title">💬 {t("محادثة واتساب")}</h2>
        <WaChat phone={lead.phone} compact />
        <Link href={`${staff ? "/admin" : "/agent"}/inbox?p=${lead.phone}`} className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">{t("افتحها في صندوق الواتساب ←")}</Link>
      </section>
      <section className="card h-fit">
        <h2 className="mb-3 font-semibold">{t("سجل الحركة")}</h2>
        <ol className="space-y-3 text-sm">
          {(activity ?? []).map((a) => (
            <li key={a.id} className="border-s-2 border-brand-500 ps-3">
              <p className="font-medium">
                {a.from_status ? t("{0} ← ", t(LEAD_STATUS_LABELS[a.from_status as LeadStatus])) : ""}
                {a.to_status ? t(LEAD_STATUS_LABELS[a.to_status as LeadStatus]) : t(a.note ?? "")}
              </p>
              <p className="text-xs text-zinc-500">
                {(a.actor as unknown as { full_name: string } | null)?.full_name ?? t("النظام")} · {formatDate(a.created_at)}
              </p>
            </li>
          ))}
        </ol>
      </section>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
