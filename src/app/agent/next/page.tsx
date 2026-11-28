import Link from "next/link";
import { Clock, Coffee, ExternalLink, Phone, PhoneCall, RotateCcw, SkipForward, Sparkles, UserRound, X } from "lucide-react";
import { CallPanel } from "@/components/call-panel";
import { CallScript } from "@/components/call-script";
import { CompanyTerms } from "@/components/company-terms";
import type { Terms } from "@/lib/terms";
import { CallButton } from "@/components/call-timer";
import { CompanyLogo, Empty, StatusBadge, formatDate } from "@/components/ui";
import { WhatsAppMenu } from "@/components/whatsapp-menu";
import { requireAgent } from "@/lib/view-as";
import { formatFieldValue } from "@/lib/forms";
import { getLocale, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cairoDateTime } from "@/lib/time";
import { placeName, type FormField, type LeadStatus } from "@/lib/types";
import { templatesFor, type Template } from "@/lib/whatsapp";
import { MAX_ATTEMPTS, pickNextLead, queueClock } from "@/lib/next-lead";

const SELECT =
  "id, full_name, phone, status, notes, source, form_data, created_at, attempts, last_contact_at, callback_at, interview_at, interview_place, company_id, companies(name, logo_path, form_schema, call_script, salary, order_price, working_hours, terms), governorates(name_ar, name_en), regions(name_ar)";
const UUID = /^[0-9a-f-]{36}$/i;

type NextLead = {
  id: string; full_name: string; phone: string; status: string; notes: string | null; source: string; form_data: unknown;
  created_at: string; attempts: number; last_contact_at: string | null; callback_at: string | null;
  interview_at: string | null; interview_place: string | null; company_id: string;
  companies: unknown; governorates: unknown; regions: unknown;
};

/** Calling mode: one lead at a time — due call-backs first, then new leads, then no-answers worth retrying. */
export default async function NextLeadPage({ searchParams }: PageProps<"/agent/next">) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const profile = await requireAgent();
  const supabase = await createClient();
  const sp = await searchParams;
  const skip = String(sp.skip ?? "").split(",").filter((s) => UUID.test(s)).slice(-50);
  const { now, retryBefore } = queueClock();
  const count = () => supabase.from("leads").select("id", { count: "exact", head: true }).eq("agent_id", profile.id);

  const [{ lead, queue }, dueCount, newCount, retryCount, tplRes] = await Promise.all([
    pickNextLead<NextLead>(supabase, profile.id, SELECT, skip),
    count().lte("callback_at", now).not("status", "in", "(hired,rejected)"),
    count().eq("status", "new").is("callback_at", null),
    count().eq("status", "no_answer").is("callback_at", null).lt("attempts", MAX_ATTEMPTS).or(`last_contact_at.is.null,last_contact_at.lt.${retryBefore}`),
    supabase.from("whatsapp_templates").select("id, title, body, company_id").order("sort").order("created_at"),
  ]);

  const counters = [
    { key: "callback", label: t("متأجلة جه معادها"), value: dueCount.count ?? 0, icon: Clock },
    { key: "new", label: t("جديدة"), value: newCount.count ?? 0, icon: Sparkles },
    { key: "retry", label: t("مردوش"), value: retryCount.count ?? 0, icon: RotateCcw },
  ];
  const left = counters.reduce((s, c) => s + c.value, 0);

  // Calling mode: one slim bar instead of a page header and three cards, so the lead fills the screen.
  const header = (
    <div data-focus className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-extrabold tracking-tight">{t("ابدأ المكالمات")}</h1>
        <span className="text-sm text-zinc-500">{left > 0 ? t("فاضل {0} مكالمة", left) : t("مفيش مكالمات مستنياك")}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {counters.map((c) => (
          <li key={c.key} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${queue === c.key ? "bg-(--fg) text-(--surface)" : "bg-zinc-100 text-zinc-600"}`}>
            <c.icon size={12} /> {c.label} <span className="num font-semibold">{c.value}</span>
          </li>
        ))}
      </ul>
      <div className="ms-auto flex items-center gap-2">
        {skip.length > 0 && (
          <Link href="/agent/next" className="btn-ghost btn-sm"><RotateCcw size={14} /> {t("رجّع اللي عدّيتهم ({0})", skip.length)}</Link>
        )}
        <Link href="/agent" className="btn-ghost btn-sm"><X size={14} /> {t("خروج")}</Link>
      </div>
    </div>
  );
  if (!lead) {
    return (
      <>
        {header}
        <section className="card">
          <Empty icon={Coffee}>
            <p className="text-base font-bold text-ink">{t("خلّصت كل المكالمات المطلوبة دلوقتي 👏")}</p>
            <p className="mt-1">{t("الليدز اللي مردتش هترجع هنا بعد ساعتين، والمكالمات المتأجلة هترجع في معادها.")}</p>
          </Empty>
        </section>
      </>
    );
  }

  const company = lead.companies as unknown as { name: string; logo_path: string | null; form_schema: FormField[]; call_script: string | null } & Terms;
  const formData = (lead.form_data ?? {}) as Record<string, unknown>;
  const templates = templatesFor((tplRes.data ?? []) as Template[], lead.company_id);
  const vars = {
    name: lead.full_name.split(" ")[0],
    company: company.name,
    agent: profile.full_name.split(" ")[0],
    interviewAt: lead.interview_at ? cairoDateTime(lead.interview_at, "ar") : undefined,
    interviewPlace: lead.interview_place ?? undefined,
  };
  const skipHref = `/agent/next?skip=${[...skip, lead.id].join(",")}`;
  const reason =
    queue === "callback"
      ? t("طلب نكلمه {0}", cairoDateTime(lead.callback_at!, locale))
      : queue === "new"
        ? t("ليد جديد مستني أول مكالمة")
        : t("مردش {0} مرة — آخر محاولة {1}", lead.attempts, lead.last_contact_at ? cairoDateTime(lead.last_contact_at, locale) : "—");

  return (
    <>
      {header}
      <div className="grid gap-5 lg:grid-cols-5">
        <section key={lead.id} className="card animate-slide-in space-y-5 lg:col-span-3">
          <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${queue === "callback" ? "bg-amber-50 text-amber-800" : queue === "new" ? "bg-brand-50 text-brand-700" : "bg-zinc-100 text-zinc-600"}`}>
            {queue === "callback" ? <Clock size={13} /> : queue === "new" ? <Sparkles size={13} /> : <RotateCcw size={13} />} {reason}
          </p>
          <div className="flex items-center gap-4">
            <CompanyLogo name={company.name} src={company.logo_path} size={60} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-extrabold">{lead.full_name}</h2>
              <p className="text-sm text-zinc-500">
                {company.name} · {[placeName(lead.governorates as unknown as { name_ar: string; name_en: string | null }, locale), (lead.regions as unknown as { name_ar: string } | null)?.name_ar].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <StatusBadge status={lead.status as LeadStatus} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CallButton leadId={lead.id} name={lead.full_name} phone={lead.phone} className="btn-primary px-6 py-3.5 text-base">
              <PhoneCall size={20} /> <span dir="ltr" className="num">{lead.phone}</span>
            </CallButton>
            <WhatsAppMenu leadId={lead.id} phone={lead.phone} templates={templates} vars={vars} />
            <Link href={`/agent/leads/${lead.id}`} className="btn-ghost"><ExternalLink size={16} /> {t("صفحة الليد")}</Link>
            <Link href={skipHref} className="btn-ghost ms-auto"><SkipForward size={16} /> {t("عدّي")} <kbd className="hidden rounded-md bg-zinc-100 px-1.5 text-[11px] text-zinc-500 lg:inline">N</kbd></Link>
          </div>

          <CompanyTerms terms={company} />
          <CallScript script={company.call_script} />

          <div>
            <h3 className="mb-2 text-sm font-bold text-zinc-600">{t("نتيجة المكالمة")}</h3>
            <CallPanel leadId={lead.id} shortcuts skipHref={skipHref} />
          </div>
        </section>

        <aside className="card h-fit space-y-3 text-sm lg:col-span-2">
          <h3 className="card-title mb-2"><UserRound size={18} className="text-zinc-500" /> {t("بيانات المتقدم")}</h3>
          <dl className="grid grid-cols-2 gap-2">
            <Info label={t("المصدر")}>{lead.source}</Info>
            <Info label={t("تاريخ التسجيل")}>{formatDate(lead.created_at)}</Info>
            <Info label={t("محاولات الاتصال")}><span className="num">{lead.attempts}</span></Info>
            <Info label={t("آخر تواصل")}>{lead.last_contact_at ? formatDate(lead.last_contact_at) : "—"}</Info>
            {company.form_schema.map((f) => (
              <Info key={f.key} label={f.label}>{formatFieldValue(f, formData[f.key])}</Info>
            ))}
          </dl>
          {lead.notes && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{lead.notes}</p>}
          <p className="flex items-center gap-1.5 text-xs text-zinc-400"><Phone size={12} /> {t("الترتيب: المتأجلة اللي جه معادها ← الجديدة ← اللي مردتش من ساعتين")}</p>
          <p className="hidden text-xs text-zinc-400 lg:block">{t("من الكيبورد: 1 لـ 6 تسجل النتيجة، و N تعدّي")}</p>
        </aside>
      </div>
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
