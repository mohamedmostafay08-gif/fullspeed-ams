import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, PieChart, TrendingUp, Trophy, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live";
import { CompanyLogo, Empty, Progress, StatCard } from "@/components/ui";
import { cairoRange, cairoToday, requireRole, STAFF } from "@/lib/auth";
import { MISSING_SERVICE_KEY, hasServiceKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

type Row = { agent_id: string; company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };
type Agg = { leads: number; hired: number; tLeads: number; tHired: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_BAR: Record<LeadStatus, string> = {
  new: "bg-sky-400",
  no_answer: "bg-zinc-400",
  contacted: "bg-indigo-400",
  interview: "bg-amber-400",
  documents: "bg-violet-400",
  hired: "bg-emerald-500",
  rejected: "bg-rose-400",
};

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const profile = await requireRole(...STAFF);
  const sp = await searchParams;
  const today = cairoToday();
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : today;
  const to = typeof sp.to === "string" && DATE_RE.test(sp.to) ? sp.to : from;

  const [start, end] = cairoRange(from, to);
  const supabase = await createClient();
  const [perf, agentsRes, companiesRes, statusRes, teamsRes, unassigned] = await Promise.all([
    supabase.rpc("performance_summary", { p_from: from, p_to: to }),
    supabase.from("profiles").select("id, full_name, role, team_id, is_active").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("companies").select("id, name, logo_path").order("name"),
    supabase.rpc("lead_status_counts", { p_start: start, p_end: end }),
    supabase.from("teams").select("id, name"),
    supabase.from("leads").select("id", { count: "exact", head: true }).is("agent_id", null),
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

  const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const presets = [
    { label: "النهارده", from: today, to: today },
    { label: "امبارح", from: shift(-1), to: shift(-1) },
    { label: "آخر 7 أيام", from: shift(-6), to: today },
    { label: "الشهر ده", from: `${today.slice(0, 8)}01`, to: today },
  ];
  const ranked = agents
    .map((a) => ({ ...a, agg: byAgent.get(a.id) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 } }))
    .sort((a, b) => b.agg.hired - a.agg.hired || b.agg.leads - a.agg.leads);
  const statusTotal = [...statusCounts.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <LiveRefresh channel="admin-overview" />
      <PageHeader title={`أهلاً ${profile.full_name.split(" ")[0]}`} subtitle={from === to ? `أداء يوم ${from}` : `الأداء من ${from} إلى ${to}`}>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Link key={p.label} href={`/admin?from=${p.from}&to=${p.to}`} className={`chip ${p.from === from && p.to === to ? "chip-active" : ""}`}>
              {p.label}
            </Link>
          ))}
        </div>
        <form className="flex items-center gap-1.5">
          <input type="date" name="from" defaultValue={from} className="input w-auto py-1.5" aria-label="من" />
          <input type="date" name="to" defaultValue={to} className="input w-auto py-1.5" aria-label="إلى" />
          <button className="btn-dark btn-sm">عرض</button>
        </form>
      </PageHeader>

      {profile.role === "admin" && !hasServiceKey() && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertTriangle size={18} className="shrink-0" />
          {MISSING_SERVICE_KEY} — من غيره إضافة الموظفين واستيراد الملفات وربط الـ CRM مش هيشتغلوا.
        </div>
      )}

      {(unassigned.count ?? 0) > 0 && (
        <Link href="/admin/leads?agent=none" className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100">
          <AlertTriangle size={18} className="shrink-0" />
          فيه {unassigned.count} ليد مش متوزعين على حد — اضغط وزّعهم
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="ليدز جديدة" value={total.leads} icon={UserPlus} progress={{ value: total.leads, target: total.tLeads }} />
        <StatCard label="اشتغلوا" value={total.hired} tone="good" icon={CheckCircle2} progress={{ value: total.hired, target: total.tHired }} />
        <StatCard label="نسبة التحويل" value={`${conversion}%`} tone="brand" icon={TrendingUp} hint="اشتغلوا ÷ ليدز" />
        <StatCard label="أجنتس نشطين" value={agents.length} icon={Users} hint={`${teamName.size} تيم`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <h2 className="card-title"><Trophy size={18} className="text-brand-600" /> ترتيب الأجنتس</h2>
          {agents.length === 0 ? (
            <Empty>مفيش أجنتس لسه — <Link href="/admin/agents" className="font-semibold text-brand-700 underline">ضيف الفريق</Link></Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th className="w-10">#</th><th>الأجنت</th><th>التيم</th><th className="w-44">ليدز</th><th className="w-44">اشتغلوا</th></tr>
                </thead>
                <tbody>
                  {ranked.map((a, i) => (
                    <tr key={a.id}>
                      <td>
                        <span className={`num grid size-7 place-items-center rounded-full text-xs font-bold ${i === 0 && a.agg.hired + a.agg.leads > 0 ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>{i + 1}</span>
                      </td>
                      <td><Link href={`/admin/agents/${a.id}`} className="font-semibold hover:text-brand-700">{a.full_name}</Link></td>
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
          <h2 className="card-title"><PieChart size={18} className="text-zinc-500" /> حالات الليدز الجديدة</h2>
          {statusTotal === 0 ? (
            <Empty>مفيش ليدز في الفترة دي</Empty>
          ) : (
            <>
              <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-zinc-100">
                {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
                  statusCounts.get(s) ? (
                    <span key={s} className={STATUS_BAR[s]} style={{ width: `${((statusCounts.get(s) ?? 0) / statusTotal) * 100}%` }} title={LEAD_STATUS_LABELS[s]} />
                  ) : null,
                )}
              </div>
              <ul className="space-y-2">
                {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
                  statusCounts.get(s) ? (
                    <li key={s} className="flex items-center justify-between">
                      <Link href={`/admin/leads?status=${s}&from=${from}&to=${to}`} className={`badge ${LEAD_STATUS_COLORS[s]} hover:opacity-80`}>{LEAD_STATUS_LABELS[s]}</Link>
                      <span className="num text-sm font-semibold">{statusCounts.get(s)}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="mt-6">
        <h2 className="card-title"><Building2 size={18} className="text-zinc-500" /> أداء الشركات</h2>
        {companies.length === 0 ? (
          <Empty>مفيش نشاط على الشركات في الفترة دي</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {companies.map((c) => (
              <Link key={c.id} href={`/admin/companies/${c.id}`} className="card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-brand-200">
                <CompanyLogo name={c.name} src={c.logo_path} size={46} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-bold">{c.name}</p>
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
