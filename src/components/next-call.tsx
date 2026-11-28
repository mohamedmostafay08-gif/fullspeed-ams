import Link from "next/link";
import { Clock, Coffee, ExternalLink, PhoneCall, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { CallPanel } from "@/components/call-panel";
import { CallButton } from "@/components/call-timer";
import { CompanyLogo } from "@/components/ui";
import { WhatsAppMenu } from "@/components/whatsapp-menu";
import { getLocale, getT } from "@/lib/i18n/server";
import { pickNextLead, type Queue } from "@/lib/next-lead";
import { createClient } from "@/lib/supabase/server";
import { cairoDateTime } from "@/lib/time";
import { templatesFor, type Template } from "@/lib/whatsapp";

export type NextCallLead = {
  id: string; full_name: string; phone: string; attempts: number; company_id: string;
  callback_at: string | null; last_contact_at: string | null; interview_at: string | null; interview_place: string | null;
  companies: { name: string; logo_path: string | null } | null;
};
const SELECT = "id, full_name, phone, attempts, company_id, callback_at, last_contact_at, interview_at, interview_place, companies(name, logo_path)";

const CHIP: Record<Queue, { cls: string; icon: typeof Clock }> = {
  callback: { cls: "bg-amber-50 text-amber-800", icon: Clock },
  new: { cls: "bg-sky-50 text-sky-800", icon: Sparkles },
  retry: { cls: "bg-zinc-100 text-zinc-600", icon: RotateCcw },
};

/** Top of the agent home: the one lead to call now, with the call button and one-tap outcomes.
 *  Logging an outcome refreshes the page, so the next lead takes its place. Same order as /agent/next. */
export async function NextCall({ agentId, agentName }: { agentId: string; agentName: string }) {
  const supabase = await createClient();
  const [{ lead, queue }, tplRes] = await Promise.all([
    pickNextLead<NextCallLead>(supabase, agentId, SELECT),
    supabase.from("whatsapp_templates").select("id, title, body, company_id").order("sort").order("created_at"),
  ]);
  return <NextCallView lead={lead} queue={queue} templates={(tplRes.data ?? []) as Template[]} agentName={agentName} />;
}

/** The card itself, kept apart from the queries. */
export async function NextCallView({ lead, queue, templates, agentName }: { lead: NextCallLead | null; queue: Queue | null; templates: Template[]; agentName: string }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);

  if (!lead || !queue) {
    return (
      <section className="card flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Coffee size={22} /></span>
        <div className="min-w-0">
          <p className="font-bold">{t("خلّصت كل المكالمات المطلوبة دلوقتي 👏")}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{t("الليدز اللي مردتش هترجع هنا بعد ساعتين، والمكالمات المتأجلة هترجع في معادها.")}</p>
        </div>
      </section>
    );
  }

  const company = lead.companies;
  const vars = {
    name: lead.full_name.split(" ")[0],
    company: company?.name ?? "",
    agent: agentName.split(" ")[0],
    interviewAt: lead.interview_at ? cairoDateTime(lead.interview_at, "ar") : undefined,
    interviewPlace: lead.interview_place ?? undefined,
  };
  const reason =
    queue === "callback"
      ? t("طلب نكلمه {0}", cairoDateTime(lead.callback_at!, locale))
      : queue === "new"
        ? t("ليد جديد مستني أول مكالمة")
        : t("مردش {0} مرة — آخر محاولة {1}", lead.attempts, lead.last_contact_at ? cairoDateTime(lead.last_contact_at, locale) : "—");
  const Chip = CHIP[queue].icon;

  return (
    <section key={lead.id} className="card animate-slide-in space-y-4" aria-labelledby="next-call-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="next-call-title" className="text-sm font-bold text-zinc-500">{t("مكالمتك الجاية")}</h2>
        <Link href="/agent/next" className="text-xs font-semibold text-zinc-500 hover:text-(--fg)">{t("وضع المكالمات ←")}</Link>
      </div>

      <div className="flex items-center gap-3">
        <CompanyLogo name={company?.name ?? "—"} src={company?.logo_path ?? null} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-extrabold md:text-2xl">{lead.full_name}</p>
          <p className="truncate text-sm text-zinc-500">{company?.name ?? "—"}</p>
        </div>
      </div>
      <p className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${CHIP[queue].cls}`}>
        <Chip size={13} /> {reason}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <CallButton leadId={lead.id} name={lead.full_name} phone={lead.phone} className="btn-primary flex-1 justify-center px-6 py-3.5 text-base sm:flex-none">
          <PhoneCall size={20} /> <span dir="ltr" className="num">{lead.phone}</span>
        </CallButton>
        <WhatsAppMenu leadId={lead.id} phone={lead.phone} templates={templatesFor(templates, lead.company_id)} vars={vars} />
        <Link href={`/agent/leads/${lead.id}`} className="btn-ghost" title={t("صفحة الليد")} aria-label={t("صفحة الليد")}><ExternalLink size={16} /></Link>
        <Link href={`/agent/next?skip=${lead.id}`} className="btn-ghost ms-auto" title={t("عدّي")}><SkipForward size={16} /> {t("عدّي")}</Link>
      </div>

      <div className="border-t border-(--glass-line) pt-4">
        <h3 className="mb-2 text-xs font-bold text-zinc-500">{t("حصل إيه في المكالمة؟")}</h3>
        <CallPanel leadId={lead.id} />
      </div>
    </section>
  );
}
