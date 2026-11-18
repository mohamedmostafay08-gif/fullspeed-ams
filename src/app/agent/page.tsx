import Link from "next/link";
import { setTaskStatus } from "@/app/actions/notifications";
import { PageHeader } from "@/components/app-shell";
import { CompanyLogo, Empty, Progress, StatCard } from "@/components/ui";
import { cairoToday, requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, type TaskPriority } from "@/lib/types";

type PerfRow = { company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };

export default async function AgentHome() {
  const profile = await requireRole("agent");
  const today = cairoToday();
  const supabase = await createClient();
  const [companies, perfRes, tasksRes, annRes, followRes] = await Promise.all([
    getAssignedCompanies(profile.id),
    supabase.rpc("performance_report", { p_from: today, p_to: today, p_agent: profile.id }),
    supabase.from("tasks").select("id, title, description, priority, due_date, status").eq("agent_id", profile.id).in("status", ["pending", "in_progress"]).order("due_date", { nullsFirst: false }).limit(10),
    supabase
      .from("company_announcements")
      .select("id, company_id, type, title, body, amount, valid_to")
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("agent_id", profile.id).in("status", ["new", "no_answer"]),
  ]);

  const perf = (perfRes.data ?? []) as PerfRow[];
  const sum = (k: keyof PerfRow) => perf.reduce((s, r) => s + Number(r[k]), 0);
  const byCompany = new Map(perf.map((r) => [r.company_id, r]));
  const announcements = annRes.data ?? [];

  return (
    <>
      <PageHeader title={`صباح الفل يا ${profile.full_name.split(" ")[0]} 👋`} subtitle={`أداء النهارده ${today}`}>
        <Link href="/agent/leads/new" className="btn-primary">+ ليد جديد</Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ليدز النهارده" value={sum("leads_count")} hint={`التارجت ${sum("target_leads") || "—"}`} />
        <StatCard label="اشتغلوا النهارده" value={sum("hired_count")} tone="good" hint={`التارجت ${sum("target_hired") || "—"}`} />
        <StatCard label="محتاجين متابعة" value={followRes.count ?? 0} tone="brand" hint="جديد + مردش" />
        <StatCard label="تاسكات مفتوحة" value={(tasksRes.data ?? []).length} />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-semibold">شركاتي</h2>
        {companies.length === 0 ? (
          <Empty>لسه متعينتش على شركات — كلم التيم ليدر</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {companies.map((c) => {
              const p = byCompany.get(c.id);
              const anns = announcements.filter((a) => a.company_id === c.id).slice(0, 2);
              return (
                <div key={c.id} className="card space-y-3">
                  <div className="flex items-center gap-3">
                    <CompanyLogo name={c.name} src={c.logo_path} size={48} />
                    <p className="flex-1 font-semibold">{c.name}</p>
                    <Link href={`/agent/leads/new?company=${c.id}`} className="btn-ghost px-3 py-1 text-xs">+ ليد</Link>
                  </div>
                  <div className="space-y-1 text-xs text-zinc-500">
                    <p>ليدز</p>
                    <Progress value={Number(p?.leads_count ?? 0)} target={p?.target_leads ?? 0} />
                    <p>اشتغلوا</p>
                    <Progress value={Number(p?.hired_count ?? 0)} target={p?.target_hired ?? 0} />
                  </div>
                  {anns.map((a) => (
                    <div key={a.id} className={`rounded-lg p-2 text-sm ${a.type === "bonus" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
                      <p className="font-semibold">
                        {a.type === "bonus" ? "🎁 " : a.type === "rate" ? "💰 " : "ℹ️ "}
                        {a.title}{a.amount != null && ` — ${a.amount} ج.م`}
                      </p>
                      {a.body && <p className="mt-0.5 text-xs">{a.body}</p>}
                      {a.valid_to && <p className="mt-0.5 text-xs opacity-70">لحد {a.valid_to}</p>}
                    </div>
                  ))}
                  {c.description && <p className="text-xs text-zinc-500">{c.description}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card mt-6">
        <h2 className="mb-3 font-semibold">المطلوب مني</h2>
        {(tasksRes.data ?? []).length === 0 ? (
          <Empty>مفيش تاسكات مفتوحة 👌</Empty>
        ) : (
          <ul className="space-y-2">
            {(tasksRes.data ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-xs text-zinc-500">{PRIORITY_LABELS[t.priority as TaskPriority]}{t.due_date && ` · لحد ${t.due_date}`}</p>
                </div>
                <form action={setTaskStatus}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="status" value="done" />
                  <button className="btn-primary px-3 py-1 text-xs">تم ✓</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
