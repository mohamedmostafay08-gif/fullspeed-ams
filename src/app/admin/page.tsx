import Link from "next/link";
import { DeviceSetupBanner } from "@/components/pwa";
import { ForecastCard, type Forecast } from "@/components/forecast";
import { getPushPublicKey } from "@/lib/push";
import { AlertTriangle, Building2, ChevronLeft, PieChart, Trophy } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live";
import { BigNumber } from "@/components/big-number";
import { CompanyLogo, Empty, Progress } from "@/components/ui";
import { cairoRange, cairoToday, requireRole, VIEWERS } from "@/lib/auth";
import { MISSING_SERVICE_KEY, hasServiceKey } from "@/lib/supabase/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_COLORS, LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

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
  const t = await getT();
  const profile = await requireRole(...VIEWERS);
  const sp = await searchParams;
  const today = cairoToday();
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : today;
  const to = typeof sp.to === "string" && DATE_RE.test(sp.to) ? sp.to : from;

  const [start, end] = cairoRange(from, to);
  const supabase = await createClient();
  // Performance users can't read lead rows; their totals come from the server.
  const db = profile.role === "performance" ? createAdminClient() : supabase;
  const nowIso = new Date().toISOString();
  const [perf, agentsRes, companiesRes, statusRes, teamsRes, unassigned, breaksRes, pushKey, passkeysRes, forecastRes, waitingRes, oldestRes, overdueRes, badgesRes] = await Promise.all([
    db.rpc("performance_summary", { p_from: from, p_to: to }),
    supabase.from("profiles").select("id, full_name, role, team_id, is_active").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("companies").select("id, name, logo_path").order("name"),
    db.rpc("lead_status_counts", { p_start: start, p_end: end }),
    supabase.from("teams").select("id, name"),
    supabase.from("leads").select("id", { count: "exact", head: true }).is("agent_id", null),
    supabase.from("agent_breaks").select("status, ends_at").eq("status", "active"),
    getPushPublicKey(),
    supabase.from("passkeys").select("id", { count: "exact", head: true }),
    db.rpc("month_forecast"),
    // The three numbers on top are live, whatever dates are picked: who is waiting for a first call,
    // and promised call-backs whose time has passed. Under RLS a team leader only counts their team.
    db.from("leads").select("id", { count: "exact", head: true }).eq("status", "new").eq("attempts", 0),
    db.from("leads").select("created_at").eq("status", "new").eq("attempts", 0).order("created_at").limit(1),
    db.from("leads").select("id", { count: "exact", head: true }).lt("callback_at", nowIso).not("status", "in", "(hired,rejected)"),
    profile.role === "performance" ? Promise.resolve({ data: null }) : supabase.rpc("nav_badges"),
  ]);
  const onBreak = (breaksRes.data ?? []).filter((b) => b.status === "active" && b.ends_at && new Date(b.ends_at) > new Date()).length;

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
  const teamName = new Map((teamsRes.data ?? []).map((row) => [row.id, row.name]));
  const statusCounts = new Map<LeadStatus, number>();
  for (const s of (statusRes.data ?? []) as { status: LeadStatus; total: number }[]) statusCounts.set(s.status, Number(s.total));
  const companies = (companiesRes.data ?? [])
    .map((c) => ({ ...c, agg: byCompany.get(c.id) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 } }))
    .filter((c) => c.agg.leads + c.agg.hired + c.agg.tLeads > 0)
    .sort((a, b) => b.agg.hired - a.agg.hired || b.agg.leads - a.agg.leads);
  const conversion = total.leads ? Math.round((total.hired / total.leads) * 100) : 0;

  const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const presets = [
    { label: t("النهارده"), from: today, to: today },
    { label: t("امبارح"), from: shift(-1), to: shift(-1) },
    { label: t("آخر 7 أيام"), from: shift(-6), to: today },
    { label: t("الشهر ده"), from: `${today.slice(0, 8)}01`, to: today },
  ];
  const ranked = agents
    .map((a) => ({ ...a, agg: byAgent.get(a.id) ?? { leads: 0, hired: 0, tLeads: 0, tHired: 0 } }))
    .sort((a, b) => b.agg.hired - a.agg.hired || b.agg.leads - a.agg.leads);
  const statusTotal = [...statusCounts.values()].reduce((a, b) => a + b, 0);

  const waiting = waitingRes.count ?? 0;
  const overdue = overdueRes.count ?? 0;
  const oldest = (oldestRes.data as { created_at: string }[] | null)?.[0]?.created_at;
  const oldestMin = oldest ? Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(oldest)) / 60_000)) : 0;
  const oldestWait = !oldest ? null : oldestMin < 60 ? t("{0} د", oldestMin) : oldestMin < 48 * 60 ? t("{0} س", Math.round(oldestMin / 60)) : t("{0} يوم", Math.round(oldestMin / 1440));
  const badges = (badgesRes.data ?? {}) as { approvals?: number; distribute?: number };
  // Everything that waits on a manager, in one list instead of a banner each.
  const attention = profile.role === "performance" ? [] : [
    { href: "/admin/approvals", label: t("طلبات مستنية موافقتك"), count: badges.approvals ?? 0 },
    { href: "/admin/leads?agent=none", label: t("ليدز مش متوزعة على حد"), count: unassigned.count ?? 0 },
    { href: "/admin/facebook-leads", label: t("ليدز مستنية شركة"), count: badges.distribute ?? 0 },
    { href: "/admin/breaks", label: t("في البريك دلوقتي"), count: onBreak },
  ].filter((a) => a.count > 0);

  return (
    <>
      <LiveRefresh channel="admin-overview" />
      <DeviceSetupBanner publicKey={pushKey} hasPasskey={(passkeysRes.count ?? 0) > 0} />
      <PageHeader title={t("أهلاً {0}", profile.full_name.split(" ")[0])} subtitle={from === to ? t("أداء يوم {0}", from) : t("الأداء من {0} إلى {1}", from, to)}>
        <div className="scroll-row -mx-4 w-[calc(100%+2rem)] px-4 sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
          {presets.map((p) => (
            <Link key={p.label} href={`/admin?from=${p.from}&to=${p.to}`} className={`chip ${p.from === from && p.to === to ? "chip-active" : ""}`}>
              {p.label}
            </Link>
          ))}
        </div>
        <form className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5 sm:flex sm:w-auto">
          <input type="date" name="from" defaultValue={from} className="input min-w-0 px-2.5 py-1.5 sm:w-auto" aria-label={t("من")} />
          <input type="date" name="to" defaultValue={to} className="input min-w-0 px-2.5 py-1.5 sm:w-auto" aria-label={t("إلى")} />
          <button className="btn-dark btn-sm">{t("عرض")}</button>
        </form>
      </PageHeader>

      {profile.role === "admin" && !hasServiceKey() && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          <AlertTriangle size={18} className="shrink-0" />
          {MISSING_SERVICE_KEY} {t("— من غيره إضافة الموظفين واستيراد الملفات وربط الـ CRM مش هيشتغلوا.")}
        </div>
      )}

      {/* Three numbers that say whether the floor is OK right now. */}
      <div className="stagger grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
        <BigNumber
          href="/admin/leads?flag=never&sort=old"
          label={t("ليدز مستنية أول مكالمة")}
          value={waiting}
          sub={oldestWait ? t("أقدمهم مستني من {0}", oldestWait) : t("محدش مستني")}
          tone={waiting > 0 && oldestMin > 60 ? "warn" : "plain"}
        />
        <BigNumber
          href="/admin/leads?flag=callback_due"
          label={t("مكالمات متأخرة")}
          value={overdue}
          sub={t("معاد المكالمة عدّى ولسه محدش كلّمهم")}
          tone={overdue > 0 ? "bad" : "plain"}
        />
        <BigNumber
          label={from === to && from === today ? t("اتعيّنوا النهارده") : t("اتعيّنوا في الفترة دي")}
          value={total.hired}
          sub={total.tHired ? t("من {0} تارجت · {1} ليد · تحويل {2}%", total.tHired, total.leads, conversion) : t("{0} ليد · تحويل {1}%", total.leads, conversion)}
          tone={total.tHired && total.hired >= total.tHired ? "good" : "plain"}
        />
      </div>

      {attention.length > 0 && (
        <section className="card mt-5" aria-labelledby="attention-title">
          <h2 id="attention-title" className="card-title"><AlertTriangle size={18} className="text-amber-500" /> {t("محتاج انتباهك")}</h2>
          <ul className="divide-y divide-(--glass-line)">
            {attention.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex items-center gap-3 py-2.5 text-sm hover:text-(--fg)">
                  <span className="num grid h-7 min-w-7 place-items-center rounded-full bg-zinc-100 px-2 text-xs font-bold">{a.count}</span>
                  <span className="flex-1 font-semibold">{a.label}</span>
                  <ChevronLeft size={16} className="text-zinc-400 ltr:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {forecastRes.data && <div className="mt-6"><ForecastCard f={forecastRes.data as Forecast} /></div>}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <h2 className="card-title"><Trophy size={18} className="text-brand-600" /> {t("ترتيب الأجنتس")}</h2>
          {agents.length === 0 ? (
            <Empty>{t("مفيش أجنتس لسه —")} <Link href="/admin/agents" className="font-semibold text-brand-700 underline">{t("ضيف الفريق")}</Link></Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th className="w-10">#</th><th>{t("الأجنت")}</th><th>{t("التيم")}</th><th className="w-44">{t("ليدز")}</th><th className="w-44">{t("اشتغلوا")}</th></tr>
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
          <h2 className="card-title"><PieChart size={18} className="text-zinc-500" /> {t("حالات الليدز الجديدة")}</h2>
          {statusTotal === 0 ? (
            <Empty>{t("مفيش ليدز في الفترة دي")}</Empty>
          ) : (
            <>
              <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-zinc-100">
                {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
                  statusCounts.get(s) ? (
                    <span key={s} className={STATUS_BAR[s]} style={{ width: `${((statusCounts.get(s) ?? 0) / statusTotal) * 100}%` }} title={t(LEAD_STATUS_LABELS[s])} />
                  ) : null,
                )}
              </div>
              <ul className="space-y-2">
                {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
                  statusCounts.get(s) ? (
                    <li key={s} className="flex items-center justify-between">
                      <Link href={`/admin/leads?status=${s}&from=${from}&to=${to}`} className={`badge ${LEAD_STATUS_COLORS[s]} hover:opacity-80`}>{LEAD_STATUS_EMOJI[s]} {t(LEAD_STATUS_LABELS[s])}</Link>
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
        <h2 className="card-title"><Building2 size={18} className="text-zinc-500" /> {t("أداء الشركات")}</h2>
        {companies.length === 0 ? (
          <Empty>{t("مفيش نشاط على الشركات في الفترة دي")}</Empty>
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
