import Link from "next/link";
import { BellRing, CheckCircle2, ClipboardList, Gift, Plus, UserPlus } from "lucide-react";
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

type PerfRow = { company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };

const PRIORITY_DOT: Record<TaskPriority, string> = { high: "bg-rose-500", medium: "bg-amber-400", low: "bg-zinc-300" };

export default async function AgentHome() {
  const profile = await requireRole("agent");
  const today = cairoToday();
  const supabase = await createClient();
  const [dayStart, dayEnd] = cairoRange(today, today);
  const [companies, perfRes, tasksRes, annRes, followRes, breaksRes] = await Promise.all([
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
  ]);

  const perf = (perfRes.data ?? []) as PerfRow[];
  const sum = (k: keyof PerfRow) => perf.reduce((s, r) => s + Number(r[k]), 0);
  const byCompany = new Map(perf.map((r) => [r.company_id, r]));
  const announcements = annRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const follow = followRes.data ?? [];

  return (
    <>
      <LiveRefresh channel={`agent-${profile.id}`} />
      <PageHeader title={`صباح الفل يا ${profile.full_name.split(" ")[0]}`} subtitle={`ده أداءك النهارده — ${today}`}>
        <Link href="/agent/leads/new" className="btn-primary">
          <Plus size={18} /> ليد جديد
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="ليدز النهارده" value={sum("leads_count")} icon={UserPlus} progress={{ value: sum("leads_count"), target: sum("target_leads") }} />
        <StatCard label="اشتغلوا" value={sum("hired_count")} tone="good" icon={CheckCircle2} progress={{ value: sum("hired_count"), target: sum("target_hired") }} />
        <StatCard label="محتاجين متابعة" value={followRes.count ?? 0} tone="brand" icon={BellRing} hint="جديد + مردش" />
        <StatCard label="تاسكات مفتوحة" value={tasks.length} tone="warn" icon={ClipboardList} hint="من التيم ليدر" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="card-title">شركاتي</h2>
          {companies.length === 0 ? (
            <Empty>لسه متعينتش على شركات — كلم التيم ليدر</Empty>
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
                        <Plus size={14} /> ليد
                      </Link>
                    </div>
                    <dl className="space-y-2 text-xs text-zinc-500">
                      <div><dt className="mb-1">ليدز</dt><dd><Progress value={Number(p?.leads_count ?? 0)} target={p?.target_leads ?? 0} /></dd></div>
                      <div><dt className="mb-1">اشتغلوا</dt><dd><Progress value={Number(p?.hired_count ?? 0)} target={p?.target_hired ?? 0} /></dd></div>
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
                            {a.amount != null && <span className="num"> — {a.amount} ج.م</span>}
                          </p>
                          {a.body && <p className="mt-0.5 text-xs opacity-80">{a.body}</p>}
                          {a.valid_to && <p className="mt-0.5 text-[11px] opacity-60">ساري لحد {a.valid_to}</p>}
                        </div>
                      </div>
                    ))}
                    {c.description && <p className="text-xs leading-5 text-zinc-500">{c.description}</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <BreakWidget today={(breaksRes.data ?? []) as BreakRow[]} />

          <section className="card">
            <h2 className="card-title"><BellRing size={18} className="text-brand-600" /> كلّمهم النهارده</h2>
            {follow.length === 0 ? (
              <Empty>مفيش حد مستني مكالمة</Empty>
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
            <h2 className="card-title"><ClipboardList size={18} className="text-amber-500" /> المطلوب مني</h2>
            {tasks.length === 0 ? (
              <Empty icon={CheckCircle2}>مفيش تاسكات مفتوحة</Empty>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
                    <span className={`size-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority as TaskPriority]}`} title={PRIORITY_LABELS[t.priority as TaskPriority]} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t.title}</p>
                      {t.due_date && <p className="text-[11px] text-zinc-400">لحد {t.due_date}</p>}
                    </div>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <button className="btn-primary btn-sm">تم</button>
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
