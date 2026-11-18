import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { CompanyLogo, Empty, Progress, StatCard } from "@/components/ui";
import { cairoRange, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

type Row = { agent_id: string; company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };
type Agg = { leads: number; hired: number; tLeads: number; tHired: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const profile = await requireRole("admin", "team_leader");
  const sp = await searchParams;
  const today = cairoToday();
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : today;
  const to = typeof sp.to === "string" && DATE_RE.test(sp.to) ? sp.to : from;

  const [start, end] = cairoRange(from, to);
  const supabase = await createClient();
  const [perf, agentsRes, companiesRes, statusRes, teamsRes] = await Promise.all([
    supabase.rpc("performance_summary", { p_from: from, p_to: to }),
    supabase.from("profiles").select("id, full_name, role, team_id, is_active").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("companies").select("id, name, logo_path").order("name"),
    supabase.rpc("lead_status_counts", { p_start: start, p_end: end }),
    supabase.from("teams").select("id, name"),
  ]);

  const rows = (perf.data ?? []) as Row[];
  const byAgent = new Map<string, Agg>();
  const byCompany = new Map<string, Agg>();
  const total: Agg = { leads: 0, hired: 0, tLeads: 0, tHired: 0 };
  for (const r of rows) {
    for (const [map, key] of [[byAgent, r.agent_id], [byCompany, r.company_id]] as const) {
      const a = map.get(key) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 };
      a.leads += Number(r.leads_count);
      a.hired += Number(r.hired_count);
      a.tLeads += Number(r.target_leads);
      a.tHired += Number(r.target_hired);
      map.set(key, a);
    }
    total.leads += Number(r.leads_count);
    total.hired += Number(r.hired_count);
    total.tLeads += Number(r.target_leads);
    total.tHired += Number(r.target_hired);
  }

  const agents = agentsRes.data ?? [];
  const teamName = new Map((teamsRes.data ?? []).map((t) => [t.id, t.name]));
  const statusCounts = new Map<LeadStatus, number>();
  for (const s of (statusRes.data ?? []) as { status: LeadStatus; total: number }[]) statusCounts.set(s.status, Number(s.total));
  const companies = (companiesRes.data ?? [])
    .map((c) => ({ ...c, agg: byCompany.get(c.id) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 } }))
    .filter((c) => c.agg.leads + c.agg.hired + c.agg.tLeads > 0)
    .sort((a, b) => b.agg.hired - a.agg.hired || b.agg.leads - a.agg.leads);
  const conversion = total.leads ? Math.round((total.hired / total.leads) * 100) : 0;

  return (
    <>
      <PageHeader title={`أهلاً ${profile.full_name}`} subtitle={from === to ? `أداء يوم ${from}` : `الأداء من ${from} إلى ${to}`}>
        <form className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="from">من</label>
            <input id="from" type="date" name="from" defaultValue={from} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="to">إلى</label>
            <input id="to" type="date" name="to" defaultValue={to} className="input" />
          </div>
          <button className="btn-ghost">عرض</button>
        </form>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ليدز جديدة" value={total.leads} hint={total.tLeads ? `التارجت ${total.tLeads}` : undefined} />
        <StatCard label="اشتغلوا" value={total.hired} tone="good" hint={total.tHired ? `التارجت ${total.tHired}` : undefined} />
        <StatCard label="نسبة التحويل" value={`${conversion}%`} tone="brand" />
        <StatCard label="أجنتس نشطين" value={agents.length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">أداء الأجنتس</h2>
          {agents.length === 0 ? (
            <Empty>مفيش أجنتس لسه — <Link href="/admin/agents" className="text-brand-700 underline">ضيف الفريق</Link></Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>الأجنت</th><th>التيم</th><th className="w-48">ليدز / تارجت</th><th className="w-48">اشتغلوا / تارجت</th></tr>
                </thead>
                <tbody>
                  {agents
                    .map((a) => ({ ...a, agg: byAgent.get(a.id) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 } }))
                    .sort((a, b) => b.agg.hired - a.agg.hired || b.agg.leads - a.agg.leads)
                    .map((a) => (
                      <tr key={a.id}>
                        <td><Link href={`/admin/agents/${a.id}`} className="font-medium hover:text-brand-700">{a.full_name}</Link></td>
                        <td className="text-zinc-500">{a.team_id ? teamName.get(a.team_id) : "—"}</td>
                        <td><Progress value={a.agg.leads} target={a.agg.tLeads} /></td>
                        <td><Progress value={a.agg.hired} target={a.agg.tHired} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">حالات الليدز الجديدة</h2>
          {statusCounts.size === 0 ? (
            <Empty>مفيش ليدز في الفترة دي</Empty>
          ) : (
            <ul className="space-y-2">
              {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
                statusCounts.get(s) ? (
                  <li key={s} className="flex items-center justify-between">
                    <span className={`badge ${LEAD_STATUS_COLORS[s]}`}>{LEAD_STATUS_LABELS[s]}</span>
                    <span className="font-semibold tabular-nums">{statusCounts.get(s)}</span>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-6">
        <h2 className="mb-3 font-semibold">أداء الشركات</h2>
        {companies.length === 0 ? (
          <Empty>مفيش نشاط على الشركات في الفترة دي</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((c) => (
              <Link key={c.id} href={`/admin/companies/${c.id}`} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 hover:border-brand-500">
                <CompanyLogo name={c.name} src={c.logo_path} size={44} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{c.name}</p>
                  <Progress value={c.agg.leads} target={c.agg.tLeads} />
                  <Progress value={c.agg.hired} target={c.agg.tHired} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
