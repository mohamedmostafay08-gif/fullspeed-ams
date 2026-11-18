import { TargetCelebration } from "@/components/celebrate";
import { DeviceSetupBanner } from "@/components/pwa";
import { ForecastCard, type Forecast } from "@/components/forecast";
import { getPushPublicKey } from "@/lib/push";
import { BadgesCard, Leaderboard } from "@/components/leaderboard";
import { badgesFor, type AgentStats, type BoardRow } from "@/lib/badges";
import Link from "next/link";
import { BellRing, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, Clock, Gift, Flame, PhoneCall, Plus, UserPlus } from "lucide-react";
import { setTaskStatus } from "@/app/actions/notifications";
import { PageHeader } from "@/components/app-shell";
import { BreakWidget, type BreakRow } from "@/components/breaks";
import { ContactButtons } from "@/components/leads-table";
import { LeadStatusSelect, LiveRefresh } from "@/components/live";
import { CompanyLogo, Empty, Progress, StatCard, formatDate } from "@/components/ui";
import { cairoRange, cairoToday, requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, type LeadStatus, type TaskPriority } from "@/lib/types";
import { getLocale, getT } from "@/lib/i18n/server";
import { cairoTime } from "@/lib/time";

type PerfRow = { company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };

const PRIORITY_DOT: Record<TaskPriority, string> = { high: "bg-rose-500", medium: "bg-amber-400", low: "bg-zinc-300" };

export default async function AgentHome() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const profile = await requireRole("agent");
  const today = cairoToday();
  const supabase = await createClient();
  const [dayStart, dayEnd] = cairoRange(today, today);
  const [companies, perfRes, tasksRes, annRes, followRes, breaksRes, callbacksRes, interviewsRes, boardRes, statsRes, pushKey, passkeysRes, forecastRes] = await Promise.all([
    getAssignedCompanies(profile.id),
    supabase.rpc("performance_report", { p_from: today, p_to: today, p_agent: profile.id }),
    supabase
      .from("tasks")
      .select("id, title, description, priority, due_date, status")
      .eq("agent_id", profile.id)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { nullsFirst: false })
      .limit(8),
    supabase
      .from("company_announcements")
      .select("id, company_id, type, title, body, amount, valid_to")
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("leads")
      .select("id, full_name, phone, status, created_at, companies(name, logo_path)", { count: "exact" })
      .eq("agent_id", profile.id)
      .in("status", ["new", "no_answer"])
      .order("created_at", { ascending: true })
      .limit(8),
    supabase
      .from("agent_breaks")
      .select("id, status, requested_at, started_at, ends_at")
      .eq("agent_id", profile.id)
      .gte("requested_at", dayStart)
      .lt("requested_at", dayEnd)
      .order("requested_at"),
    supabase
      .from("leads")
      .select("id, full_name, phone, callback_at, companies(name)")
      .eq("agent_id", profile.id)
      .gte("callback_at", dayStart)
      .lt("callback_at", dayEnd)
      .not("status", "in", "(hired,rejected)")
      .order("callback_at"),
    supabase
      .from("leads")
      .select("id, full_name, phone, interview_at, interview_place, companies(name)")
      .eq("agent_id", profile.id)
      .eq("status", "interview")
      .gte("interview_at", dayStart)
      .lt("interview_at", dayEnd)
      .order("interview_at"),
    supabase.rpc("leaderboard", { p_from: today, p_to: today }),
    supabase.rpc("agent_stats", { p_agent: profile.id }),
    getPushPublicKey(),
    supabase.from("passkeys").select("id", { count: "exact", head: true }),
    supabase.rpc("month_forecast"),
  ]);

  const perf = (perfRes.data ?? []) as PerfRow[];
  const sum = (k: keyof PerfRow) => perf.reduce((s, r) => s + Number(r[k]), 0);
  const byCompany = new Map(perf.map((r) => [r.company_id, r]));
  const announcements = annRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const follow = followRes.data ?? [];
  const board = (boardRes.data ?? []) as BoardRow[];
  const myRank = board.findIndex((r) => r.agent_id === profile.id) + 1 || null;
  const myRow = board.find((r) => r.agent_id === profile.id);
  const stats = (statsRes.data ?? { total_leads: 0, total_hired: 0, streak: 0, calls_today: 0, avg_first_touch_min: null, leads_7d: 0 }) as AgentStats;
  const badges = badgesFor(stats, myRank, myRow?.points ?? 0);
  const now = new Date();
  const agenda = [
    ...(callbacksRes.data ?? []).map((l) => ({ kind: "callback" as const, id: l.id, name: l.full_name, phone: l.phone, at: l.callback_at!, place: null as string | null, company: (l.companies as unknown as { name: string }).name })),
    ...(interviewsRes.data ?? []).map((l) => ({ kind: "interview" as const, id: l.id, name: l.full_name, phone: l.phone, at: l.interview_at!, place: l.interview_place, company: (l.companies as unknown as { name: string }).name })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <LiveRefresh channel={`agent-${profile.id}`} />
      <TargetCelebration
        userId={profile.id}
        day={today}
        leads={sum("leads_count")}
        leadsTarget={sum("target_leads")}
        hired={sum("hired_count")}
        hiredTarget={sum("target_hired")}
      />
      <DeviceSetupBanner publicKey={pushKey} hasPasskey={(passkeysRes.count ?? 0) > 0} />
      <PageHeader title={t("صباح الفل يا {0}", profile.full_name.split(" ")[0])} subtitle={t("ده أداءك النهارده — {0}", today)}>
        {stats.streak > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-2 text-sm font-bold text-orange-700" title={t("{0} يوم ورا بعض محقق هدفه", stats.streak)}>
            <Flame size={16} className="animate-wiggle" /> {t("{0} يوم", stats.streak)}
          </span>
        )}
        {myRank && (myRow?.points ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800">
            🏆 {t("ترتيبك #{0} · {1} نقطة", myRank, myRow?.points ?? 0)}
          </span>
        )}
        <Link href="/agent/leads/new" className="btn-ghost">
          <Plus size={18} /> {t("ليد جديد")}
        </Link>
        <Link href="/agent/next" className="btn-primary relative overflow-hidden">
          <PhoneCall size={18} /> {t("ابدأ المكالمات")}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 -start-1/2 w-1/3 animate-shine bg-white/25" />
        </Link>
      </PageHeader>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label={t("ليدز النهارده")} value={sum("leads_count")} icon={UserPlus} progress={{ value: sum("leads_count"), target: sum("target_leads") }} />
        <StatCard label={t("اشتغلوا")} value={sum("hired_count")} tone="good" icon={CheckCircle2} progress={{ value: sum("hired_count"), target: sum("target_hired") }} />
        <StatCard label={t("محتاجين متابعة")} value={followRes.count ?? 0} tone="brand" icon={BellRing} hint={t("جديد + مردش")} />
        <StatCard label={t("تاسكات مفتوحة")} value={tasks.length} tone="warn" icon={ClipboardList} hint={t("من التيم ليدر")} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="card-title">{t("شركاتي")}</h2>
          {companies.length === 0 ? (
            <Empty>{t("لسه متعينتش على شركات — كلم التيم ليدر")}</Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {companies.map((c) => {
                const p = byCompany.get(c.id);
                const anns = announcements.filter((a) => a.company_id === c.id).slice(0, 2);
                return (
                  <article key={c.id} className="card flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <CompanyLogo name={c.name} src={c.logo_path} size={46} />
                      <p className="flex-1 font-bold">{c.name}</p>
                      <Link href={`/agent/leads/new?company=${c.id}`} className="btn-ghost btn-sm">
                        <Plus size={14} /> {t("ليد")}
                      </Link>
                    </div>
                    <dl className="space-y-2 text-xs text-zinc-500">
                      <div><dt className="mb-1">{t("ليدز")}</dt><dd><Progress value={Number(p?.leads_count ?? 0)} target={p?.target_leads ?? 0} /></dd></div>
                      <div><dt className="mb-1">{t("اشتغلوا")}</dt><dd><Progress value={Number(p?.hired_count ?? 0)} target={p?.target_hired ?? 0} /></dd></div>
                    </dl>
                    {anns.map((a) => (
                      <div
                        key={a.id}
                        className={`flex gap-2.5 rounded-xl p-3 text-sm ${a.type === "bonus" ? "bg-emerald-50 text-emerald-900" : a.type === "rate" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}
                      >
                        <Gift size={16} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-bold">
                            {a.title}
                            {a.amount != null && <span className="num"> — {a.amount} {t("ج.م")}</span>}
                          </p>
                          {a.body && <p className="mt-0.5 text-xs opacity-80">{a.body}</p>}
                          {a.valid_to && <p className="mt-0.5 text-[11px] opacity-60">{t("ساري لحد")} {a.valid_to}</p>}
                        </div>
                      </div>
                    ))}
                    {c.description && <p className="text-xs leading-5 text-zinc-500">{c.description}</p>}
                  </article>
                );
              })}
            </div>
          )}
          <div className="mt-6"><BadgesCard badges={badges} /></div>
        </section>

        <div className="space-y-6">
          <BreakWidget today={(breaksRes.data ?? []) as BreakRow[]} />

          <Leaderboard rows={board} me={profile.id} />

          {(forecastRes.data as Forecast | null)?.agents?.length ? <ForecastCard f={forecastRes.data as Forecast} personal /> : null}

          <section className="card">
            <h2 className="card-title"><CalendarDays size={18} className="text-violet-500" /> {t("مواعيدي النهارده")}</h2>
            {agenda.length === 0 ? (
              <Empty icon={CalendarDays}>{t("مفيش مواعيد النهارده")}</Empty>
            ) : (
              <ol className="space-y-2">
                {agenda.map((a) => {
                  const past = new Date(a.at) <= now;
                  return (
                    <li key={`${a.kind}-${a.id}`} className={`flex items-center gap-3 rounded-xl border p-2.5 ${a.kind === "interview" ? "border-violet-200 bg-violet-50/60" : past ? "border-amber-200 bg-amber-50" : "border-zinc-200"}`}>
                      <span className="num w-14 shrink-0 text-center text-sm font-bold">{cairoTime(a.at, locale)}</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/agent/leads/${a.id}`} className="block truncate text-sm font-semibold hover:text-brand-700">{a.name}</Link>
                        <p className="flex items-center gap-1 truncate text-[11px] text-zinc-500">
                          {a.kind === "interview" ? <CalendarClock size={11} /> : <Clock size={11} />}
                          {a.kind === "interview" ? t("مقابلة") : t("مكالمة")} · {a.company}{a.place ? ` · ${a.place}` : ""}
                        </p>
                      </div>
                      <ContactButtons phone={a.phone} />
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="card">
            <h2 className="card-title"><BellRing size={18} className="text-brand-600" /> {t("كلّمهم النهارده")}</h2>
            {follow.length === 0 ? (
              <Empty>{t("مفيش حد مستني مكالمة")}</Empty>
            ) : (
              <ul className="-mx-2 divide-y divide-zinc-100">
                {follow.map((l) => {
                  const c = l.companies as unknown as { name: string; logo_path: string | null };
                  return (
                    <li key={l.id} className="flex items-center gap-2.5 px-2 py-2.5">
                      <CompanyLogo name={c.name} src={c.logo_path} size={30} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/agent/leads/${l.id}`} className="block truncate text-sm font-semibold hover:text-brand-700">{l.full_name}</Link>
                        <p className="truncate text-[11px] whitespace-nowrap text-zinc-400">{formatDate(l.created_at)}</p>
                      </div>
                      <ContactButtons phone={l.phone} />
                      <LeadStatusSelect id={l.id} status={l.status as LeadStatus} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="card-title"><ClipboardList size={18} className="text-amber-500" /> {t("المطلوب مني")}</h2>
            {tasks.length === 0 ? (
              <Empty icon={CheckCircle2}>{t("مفيش تاسكات مفتوحة")}</Empty>
            ) : (
              <ul className="space-y-2">
                {tasks.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
                    <span className={`size-2 shrink-0 rounded-full ${PRIORITY_DOT[row.priority as TaskPriority]}`} title={t(PRIORITY_LABELS[row.priority as TaskPriority])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{row.title}</p>
                      {row.due_date && <p className="text-[11px] text-zinc-400">{t("لحد")} {row.due_date}</p>}
                    </div>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className="btn-primary btn-sm">{t("تم")}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
