import Link from "next/link";
import { ListTodo, PhoneCall } from "lucide-react";
import { ContactButtons } from "@/components/leads-table";
import { CompanyLogo, Empty } from "@/components/ui";
import { cairoRange, cairoToday } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";
import { cairoTime } from "@/lib/time";

type Company = { name: string; logo_path: string | null };
type Lead = {
  id: string; full_name: string; phone: string; status: string; attempts: number; created_at: string;
  callback_at: string | null; interview_at: string | null; interview_place: string | null; last_contact_at: string | null;
  companies: Company | null;
};
type Item = { lead: Lead; time: string; note: string; tone: "red" | "amber" | "violet" | "sky" | "zinc" };

const SELECT = "id, full_name, phone, status, attempts, created_at, callback_at, interview_at, interview_place, last_contact_at, companies(name, logo_path)";
const OPEN = "(hired,rejected)";
const TONE: Record<Item["tone"], string> = {
  red: "border-rose-200 bg-rose-50/70",
  amber: "border-amber-200 bg-amber-50/70",
  violet: "border-violet-200 bg-violet-50/60",
  sky: "border-sky-200 bg-sky-50/60",
  zinc: "border-(--glass-line)",
};

/** "45 min", "3 h", "2 days": how long something has been waiting. */
function waited(t: T, iso: string, now: number) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return t("{0} د", m);
  if (m < 48 * 60) return t("{0} س", Math.round(m / 60));
  return t("{0} يوم", Math.round(m / 1440));
}

/** Everything the agent has to do today, most urgent first: callbacks due, new leads, interviews,
 *  later callbacks, then no-answers worth another try. Shown on the agent home ("اليوم"). */
export async function TodayQueue({ agentId }: { agentId: string }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const today = cairoToday();
  const [dayStart, dayEnd] = cairoRange(today, today);
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const supabase = await createClient();
  const mine = () => supabase.from("leads").select(SELECT).eq("agent_id", agentId);

  const [overdueRes, newRes, interviewRes, laterRes, retryRes] = await Promise.all([
    // Callbacks whose time has come, today or earlier, that are still open.
    mine().lte("callback_at", nowIso).not("status", "in", OPEN).order("callback_at").limit(50),
    // New leads nobody has called yet, oldest first.
    mine().eq("status", "new").eq("attempts", 0).is("callback_at", null).order("created_at").limit(50),
    // Today's interviews in time order.
    mine().eq("status", "interview").gte("interview_at", dayStart).lt("interview_at", dayEnd).order("interview_at"),
    // Callbacks still to come later today.
    mine().gt("callback_at", nowIso).lt("callback_at", dayEnd).not("status", "in", OPEN).order("callback_at"),
    // Didn't answer, no callback set, fewer than 3 tries: worth another go.
    mine().eq("status", "no_answer").is("callback_at", null).lt("attempts", 3).order("last_contact_at", { nullsFirst: true }).limit(30),
  ]);
  const rows = (r: { data: unknown }) => (r.data ?? []) as Lead[];

  const sections: { key: string; emoji: string; title: string; hint: string; items: Item[] }[] = [
    {
      key: "overdue",
      emoji: "🔴",
      title: t("مكالمات متأجلة جه معادها"),
      hint: t("وعدتهم تكلّمهم — ابدأ بيهم"),
      items: rows(overdueRes).map((lead) => ({
        lead,
        time: cairoTime(lead.callback_at!, locale),
        note: lead.callback_at! < dayStart ? t("متأخرة من {0}", waited(t, lead.callback_at!, now)) : t("كان معادها {0}", cairoTime(lead.callback_at!, locale)),
        tone: "red",
      })),
    },
    {
      key: "new",
      emoji: "🆕",
      title: t("ليدز جديدة مستنية"),
      hint: t("محدش كلّمهم لسه — الأقدم الأول"),
      items: rows(newRes).map((lead) => {
        const mins = (now - Date.parse(lead.created_at)) / 60_000;
        return { lead, time: waited(t, lead.created_at, now), note: t("مستني من {0}", waited(t, lead.created_at, now)), tone: mins >= 60 ? "red" : mins >= 30 ? "amber" : "sky" };
      }),
    },
    {
      key: "interviews",
      emoji: "🤝",
      title: t("مقابلات النهارده"),
      hint: t("فكّرهم قبل المعاد بساعة"),
      items: rows(interviewRes).map((lead) => ({
        lead,
        time: cairoTime(lead.interview_at!, locale),
        note: (Date.parse(lead.interview_at!) <= now ? t("المعاد عدّى — اتأكد إنه راح") : t("الساعة {0}", cairoTime(lead.interview_at!, locale))) + (lead.interview_place ? ` · ${lead.interview_place}` : ""),
        tone: "violet",
      })),
    },
    {
      key: "later",
      emoji: "⏰",
      title: t("مكالمات باقي النهارده"),
      hint: t("لسه معادها مجاش"),
      items: rows(laterRes).map((lead) => ({ lead, time: cairoTime(lead.callback_at!, locale), note: t("الساعة {0}", cairoTime(lead.callback_at!, locale)), tone: "zinc" })),
    },
    {
      key: "retry",
      emoji: "📵",
      title: t("مردوش — جرّب تاني"),
      hint: t("أقل من 3 محاولات ومفيش معاد متحدد"),
      items: rows(retryRes).map((lead) => ({
        lead,
        time: t("{0}/3", lead.attempts),
        note: lead.last_contact_at ? t("آخر محاولة من {0}", waited(t, lead.last_contact_at, now)) : t("محاولة {0}", lead.attempts),
        tone: "zinc",
      })),
    },
  ];
  const total = sections.reduce((s, x) => s + x.items.length, 0);

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="card-title mb-0"><ListTodo size={18} className="text-brand-600" /> {t("طابور النهارده")}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{total ? t("{0} حاجة مستنياك — مرتبين من الأهم للأقل", total) : t("خلّصت كل اللي عليك 👏")}</p>
        </div>
        {total > 0 && <Link href="/agent/next" className="btn-primary btn-sm"><PhoneCall size={15} /> {t("ابدأ من الأول")}</Link>}
      </div>
      {total === 0 ? (
        <Empty>{t("مفيش حاجة هنا")}</Empty>
      ) : (
        <div className="space-y-5">
          {sections.filter((s) => s.items.length > 0).map((s) => (
            <div key={s.key}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">{s.emoji} {s.title} <span className="num rounded-full bg-(--glass-strong) px-2 text-xs text-zinc-500">{s.items.length}</span></h3>
                <p className="text-[11px] text-zinc-500">{s.hint}</p>
              </div>
              <ol className="space-y-2">
                {s.items.map(({ lead, time, note, tone }) => (
                  <li key={lead.id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${TONE[tone]}`}>
                    <span className="num w-14 shrink-0 text-center text-sm font-bold">{time}</span>
                    {lead.companies && <CompanyLogo name={lead.companies.name} src={lead.companies.logo_path} size={30} />}
                    <div className="min-w-0 flex-1">
                      <Link href={`/agent/leads/${lead.id}`} className="block truncate text-sm font-semibold hover:text-brand-700">{lead.full_name}</Link>
                      <p className="truncate text-[11px] text-zinc-500">{lead.companies?.name} · {note}</p>
                    </div>
                    <ContactButtons phone={lead.phone} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
