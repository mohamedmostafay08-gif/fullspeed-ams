import Link from "next/link";
import { BarChart3, Building2, CheckCircle2, Clock, Coffee, Filter, MapPin, PhoneCall, ThumbsDown, Timer, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { BarList, TrendChart } from "@/components/charts";
import { LiveRefresh } from "@/components/live";
import { CompanyLogo, Empty, StatCard } from "@/components/ui";
import { cairoToday, requireRole, VIEWERS } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LEAD_SOURCES, LEAD_STATUS_LABELS, REJECT_REASONS, type LeadStatus, type RejectReason } from "@/lib/types";
import type { T } from "@/lib/i18n/translate";
import { getLocale, getT } from "@/lib/i18n/server";
import { AnalyticsCompare, type CompareDim } from "@/components/analytics-compare";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { afArgs, afQuery, anyFilter, readAnalyticsFilters } from "@/lib/analytics-filters";

type AgentRow = {
  id: string;
  full_name: string;
  team_id: string | null;
  leads: number;
  contacted: number;
  no_answer: number;
  rejected: number;
  hired: number;
  first_touch_hours: number | null;
  breaks: number;
  break_minutes: number;
};
type Analytics = {
  totals: { leads: number; contacted: number; no_answer: number; rejected: number; unassigned: number; converted: number };
  hired: number;
  avg_hours_to_hire: number | null;
  avg_hours_first_touch: number | null;
  by_status: Partial<Record<LeadStatus, number>>;
  by_day: { day: string; leads: number; hired: number }[];
  by_source: { source: string; leads: number; hired: number }[];
  by_governorate: { name: string; leads: number; hired: number }[];
  by_company: { id: string; name: string; logo: string | null; leads: number; contacted: number; rejected: number; hired: number }[];
  by_agent: AgentRow[];
  by_team: { id: string; name: string; agents: number; leads: number; hired: number }[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = LEAD_SOURCES;
const SORTS: Record<string, { label: string; key: (a: AgentRow) => number }> = {
  hired: { label: "اشتغلوا", key: (a) => a.hired },
  leads: { label: "ليدز", key: (a) => a.leads },
  conversion: { label: "التحويل", key: (a) => (a.leads ? a.hired / a.leads : 0) },
  contact: { label: "نسبة التواصل", key: (a) => (a.leads ? a.contacted / a.leads : 0) },
  speed: { label: "سرعة الرد", key: (a) => (a.first_touch_hours == null ? -1e9 : -a.first_touch_hours) },
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const hours = (t: T, h: number | null) => (h == null ? "—" : h < 1 ? t("{0} د", Math.round(h * 60)) : h < 48 ? t("{0} س", h) : t("{0} يوم", Math.round(h / 24)));

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  const viewer = me.role === "performance";
  const sp = await searchParams;
  const today = cairoToday();
  const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : shift(-29);
  const to = typeof sp.to === "string" && DATE_RE.test(sp.to) && sp.to >= from ? sp.to : today;
  const sortKey = typeof sp.sort === "string" && Object.hasOwn(SORTS, sp.sort) ? sp.sort : "hired";
  const af = readAnalyticsFilters(sp);
  const tab = sp.tab === "compare" ? "compare" : "overview";
  const dim: CompareDim = sp.cmp === "team" || sp.cmp === "company" || sp.cmp === "source" ? sp.cmp : "agent";
  const picked = [sp.pick].flat().filter((x): x is string => typeof x === "string");
  const ids = (picked.length ? picked : typeof sp.ids === "string" ? sp.ids.split(",") : []).filter((x) => /^[\w-]{1,40}$/.test(x)).slice(0, 4);

  const supabase = await createClient();
  const db = viewer ? createAdminClient() : supabase;
  const [filteredRes, { data: teams }, { data: reasonsData }, { data: companyList }, { data: agentList }, { data: govs }, locale] = await Promise.all([
    db.rpc("analytics_filtered", { p_from: from, p_to: to, ...afArgs(af) }),
    supabase.from("teams").select("id, name").order("name"),
    supabase.rpc("rejection_reasons", { p_from: from, p_to: to }),
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("governorates").select("id, name_ar, name_en").order("id"),
    getLocale(),
  ]);
  // Before the filtered function exists in the database, fall back to the unfiltered one.
  const { data, error } = filteredRes.error && !anyFilter(af) ? await db.rpc("acquisition_analytics", { p_from: from, p_to: to }) : filteredRes;
  const opts = {
    team: (teams ?? []).map((x) => ({ id: x.id, name: x.name })),
    company: (companyList ?? []).map((x) => ({ id: x.id, name: x.name })),
    agent: (agentList ?? []).map((x) => ({ id: x.id, name: x.full_name })),
    source: Object.entries(LEAD_SOURCES).map(([id, name]) => ({ id, name: t(name) })),
  };
  const govOpts = (govs ?? []).map((g) => ({ id: g.id, name: locale === "en" && g.name_en ? g.name_en : g.name_ar }));
  const filterQs = afQuery(af);
  const state = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from, to, sort: sortKey, ...(tab === "compare" ? { tab, cmp: dim } : {}), ...extra });
    for (const [k, v] of new URLSearchParams(filterQs)) p.set(k, v);
    if (tab === "compare" && ids.length && !("ids" in extra)) p.set("ids", ids.join(","));
    return p;
  };
  const reasons = (reasonsData ?? []) as { company_id: string; company: string; reason: string; n: number }[];
  const reasonLabel = (r: string) => (Object.hasOwn(REJECT_REASONS, r) ? t(REJECT_REASONS[r as RejectReason]) : t("من غير سبب"));
  const byReason = [...reasons.reduce((m, r) => m.set(r.reason, (m.get(r.reason) ?? 0) + r.n), new Map<string, number>())].sort((x, y) => y[1] - x[1]);
  const topByCompany = [...reasons.reduce((m, r) => {
    const cur = m.get(r.company_id);
    const total = (cur?.total ?? 0) + r.n;
    m.set(r.company_id, { company: r.company, total, top: !cur || r.n > cur.topN ? r.reason : cur.top, topN: !cur || r.n > cur.topN ? r.n : cur.topN });
    return m;
  }, new Map<string, { company: string; total: number; top: string; topN: number }>()).values()].sort((x, y) => y.total - x.total);
  const presets = [
    { label: t("النهارده"), from: today, to: today },
    { label: t("آخر 7 أيام"), from: shift(-6), to: today },
    { label: t("آخر 30 يوم"), from: shift(-29), to: today },
    { label: t("الشهر ده"), from: `${today.slice(0, 8)}01`, to: today },
    { label: t("آخر 90 يوم"), from: shift(-89), to: today },
  ];
  const header = (
    <PageHeader title={t("تحليلات الأكوزيشن")} subtitle={t("من {0} إلى {1}", from, to)}>
      <div className="scroll-row -mx-4 w-[calc(100%+2rem)] px-4 sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
        {presets.map((p) => (
          <Link key={p.label} href={`/admin/analytics?${state({ from: p.from, to: p.to })}`} className={`chip ${p.from === from && p.to === to ? "chip-active" : ""}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <form className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5 sm:flex sm:w-auto">
        {[...state().entries()].filter(([k]) => k !== "from" && k !== "to").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={from} className="input min-w-0 px-2.5 py-1.5 sm:w-auto" aria-label={t("من")} />
        <input type="date" name="to" defaultValue={to} className="input min-w-0 px-2.5 py-1.5 sm:w-auto" aria-label={t("إلى")} />
        <button className="btn-dark btn-sm">{t("عرض")}</button>
      </form>
    </PageHeader>
  );
  const keepForBar = Object.fromEntries([...state().entries()].filter(([k]) => !["team", "company", "agent", "source", "gov"].includes(k)));
  const toolbar = (
    <>
      <div className="mb-4 flex w-fit gap-1 rounded-xl bg-zinc-100 p-1">
        <Link href={`/admin/analytics?${(() => { const p = state(); p.delete("tab"); p.delete("cmp"); p.delete("ids"); return p; })()}`} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "overview" ? "bg-white shadow-sm" : "text-zinc-500"}`}>{t("نظرة عامة")}</Link>
        <Link href={`/admin/analytics?${state({ tab: "compare", cmp: dim })}`} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "compare" ? "bg-white shadow-sm" : "text-zinc-500"}`}>{t("مقارنات وترندات")}</Link>
      </div>
      <AnalyticsFilterBar path="/admin/analytics" f={af} keep={keepForBar} teams={opts.team} companies={opts.company} agents={opts.agent} governorates={govOpts} />
    </>
  );
  if (tab === "compare") {
    return (
      <>
        {header}
        {toolbar}
        <AnalyticsCompare
          from={from}
          to={to}
          f={af}
          asServer={viewer}
          dim={dim}
          ids={ids}
          options={opts}
          path="/admin/analytics"
          keep={Object.fromEntries([...state().entries()].filter(([k]) => k !== "cmp" && k !== "ids"))}
        />
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        {header}
        {toolbar}
        <Empty icon={BarChart3}>{t("الفترة دي مش صالحة — اختار فترة أقل من سنة")}</Empty>
      </>
    );
  }

  const a = data as Analytics;
  const teamName = new Map((teams ?? []).map((row) => [row.id, row.name]));
  const agents = [...a.by_agent].sort((x, y) => SORTS[sortKey].key(y) - SORTS[sortKey].key(x));
  const funnel: { key: LeadStatus | "all"; label: string; value: number }[] = [
    { key: "all", label: t("كل الليدز"), value: a.totals.leads },
    { key: "contacted", label: t("اتكلّموا"), value: a.totals.contacted },
    { key: "interview", label: t("وصلوا مقابلة"), value: (a.by_status.interview ?? 0) + (a.by_status.documents ?? 0) + (a.by_status.hired ?? 0) },
    { key: "documents", label: t("سلّموا أوراق"), value: (a.by_status.documents ?? 0) + (a.by_status.hired ?? 0) },
    { key: "hired", label: t("اشتغلوا"), value: a.by_status.hired ?? 0 },
  ];
  const totalBreakMin = a.by_agent.reduce((s, r) => s + Number(r.break_minutes), 0);
  const qs = `from=${from}&to=${to}${filterQs ? `&${filterQs}` : ""}`;

  return (
    <>
      <LiveRefresh channel="analytics" />
      {header}
      {toolbar}

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
        <StatCard emoji="📥" label={t("ليدز جديدة")} value={a.totals.leads} icon={UserPlus} hint={t("{0} مش متوزعين", a.totals.unassigned)} />
        <StatCard emoji="💬" label={t("اتكلّموا")} value={pct(a.totals.contacted, a.totals.leads)} icon={PhoneCall} tone="brand" hint={t("{0} ليد · {1} مردوش", a.totals.contacted, a.totals.no_answer)} />
        <StatCard emoji="🎉" label={t("اشتغلوا في الفترة")} value={a.hired} icon={CheckCircle2} tone="good" hint={t("تحويل {0}", pct(a.totals.converted, a.totals.leads))} />
        <StatCard emoji="🚫" label={t("اترفضوا")} value={a.totals.rejected} icon={Filter} tone="warn" hint={pct(a.totals.rejected, a.totals.leads)} />
        <StatCard emoji="⚡" label={t("متوسط أول رد")} value={hours(t, a.avg_hours_first_touch)} icon={Timer} hint={t("من التسجيل لأول تغيير حالة")} />
        <StatCard emoji="⏱️" label={t("متوسط وقت التعيين")} value={hours(t, a.avg_hours_to_hire)} icon={Clock} hint={t("بريكات: {0} دقيقة", Math.round(totalBreakMin))} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <h2 className="card-title"><BarChart3 size={18} className="text-zinc-500" /> {t("يوم بيوم")}</h2>
          <TrendChart data={a.by_day} />
        </section>
        <section className="card">
          <h2 className="card-title"><Filter size={18} className="text-zinc-500" /> {t("قمع التعيين")}</h2>
          <ol className="space-y-3">
            {funnel.map((f, i) => (
              <li key={f.key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold">{f.label}</span>
                  <span className="num text-zinc-500">
                    {f.value}
                    {i > 0 && <span className="text-zinc-400"> · {pct(f.value, funnel[0].value)}</span>}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${funnel[0].value ? (f.value / funnel[0].value) * 100 : 0}%`, opacity: 1 - i * 0.12 }} />
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) =>
              a.by_status[s] ? (
                <Link key={s} href={viewer ? "#" : `/admin/leads?status=${s}&${qs}`} className="chip">
                  {t(LEAD_STATUS_LABELS[s])} <b className="num">{a.by_status[s]}</b>
                </Link>
              ) : null,
            )}
          </div>
        </section>
      </div>

      <section className="card mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title mb-0"><Users size={18} className="text-zinc-500" /> {t("أداء كل أجنت")}</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-500">{t("رتّب حسب:")}</span>
            {Object.entries(SORTS).map(([k, v]) => (
              <Link key={k} href={`/admin/analytics?${qs}&sort=${k}`} className={`chip ${k === sortKey ? "chip-active" : ""}`}>{t(v.label)}</Link>
            ))}
          </div>
        </div>
        {agents.length === 0 ? (
          <Empty>{t("مفيش أجنتس")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th><th>{t("الأجنت")}</th><th>{t("التيم")}</th><th>{t("ليدز")}</th><th>{t("اتكلّموا")}</th><th>{t("مردوش")}</th><th>{t("اترفضوا")}</th><th>{t("اشتغلوا")}</th><th>{t("التحويل")}</th><th>{t("أول رد")}</th>
                  <th><span className="inline-flex items-center gap-1"><Coffee size={12} /> {t("بريك")}</span></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((r, i) => (
                  <tr key={r.id}>
                    <td className="num text-zinc-400">{i + 1}</td>
                    <td><Link href={viewer ? `/admin/scorecard?agent=${r.id}` : `/admin/agents/${r.id}`} className="font-semibold hover:text-brand-700">{r.full_name}</Link></td>
                    <td className="text-zinc-500">{r.team_id ? teamName.get(r.team_id) : "—"}</td>
                    <td className="num">{r.leads}</td>
                    <td className="num">{pct(r.contacted, r.leads)}</td>
                    <td className="num text-zinc-500">{r.no_answer}</td>
                    <td className="num text-zinc-500">{r.rejected}</td>
                    <td className="num font-semibold text-emerald-700">{r.hired}</td>
                    <td className="num">{pct(r.hired, r.leads)}</td>
                    <td className="num">{hours(t, r.first_touch_hours)}</td>
                    <td className="num text-zinc-500">{r.breaks ? t("{0} · {1} د", r.breaks, r.break_minutes) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <h2 className="card-title"><Building2 size={18} className="text-zinc-500" /> {t("الشركات")}</h2>
          {a.by_company.length === 0 ? (
            <Empty>{t("مفيش نشاط")}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>{t("الشركة")}</th><th>{t("ليدز")}</th><th>{t("اتكلّموا")}</th><th>{t("اترفضوا")}</th><th>{t("اشتغلوا")}</th><th>{t("التحويل")}</th></tr>
                </thead>
                <tbody>
                  {a.by_company.map((c) => (
                    <tr key={c.id}>
                      <td>{me.role === "performance" ? (
                        <span className="flex items-center gap-2 font-semibold"><CompanyLogo name={c.name} src={c.logo} size={26} />{c.name}</span>
                      ) : (
                        <Link href={`/admin/companies/${c.id}`} className="flex items-center gap-2 font-semibold"><CompanyLogo name={c.name} src={c.logo} size={26} />{c.name}</Link>
                      )}</td>
                      <td className="num">{c.leads}</td>
                      <td className="num">{pct(c.contacted, c.leads)}</td>
                      <td className="num text-zinc-500">{c.rejected}</td>
                      <td className="num font-semibold text-emerald-700">{c.hired}</td>
                      <td className="num">{pct(c.hired, c.leads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="card-title">{t("مصادر الليدز")}</h2>
            {a.by_source.length === 0 ? (
              <Empty>{t("مفيش")}</Empty>
            ) : (
              <BarList rows={a.by_source.map((s) => ({ label: SOURCES[s.source] ? t(SOURCES[s.source]) : s.source, value: s.leads, sub: t("{0} اشتغل", s.hired) }))} />
            )}
          </section>
          <section className="card">
            <h2 className="card-title"><MapPin size={18} className="text-zinc-500" /> {t("المحافظات")}</h2>
            {a.by_governorate.length === 0 ? (
              <Empty>{t("مفيش")}</Empty>
            ) : (
              <BarList rows={a.by_governorate.slice(0, 10).map((g) => ({ label: g.name, value: g.leads, sub: t("{0} اشتغل", g.hired) }))} />
            )}
          </section>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="card-title"><ThumbsDown size={18} className="text-rose-600" /> {t("أسباب الرفض")}</h2>
          {byReason.length === 0 ? (
            <Empty>{t("مفيش ليدز اترفضت في الفترة دي")}</Empty>
          ) : (
            <BarList rows={byReason.map(([r, n]) => ({ label: reasonLabel(r), value: n }))} />
          )}
        </section>
        <section className="card">
          <h2 className="card-title"><Building2 size={18} className="text-zinc-500" /> {t("أكتر سبب رفض في كل شركة")}</h2>
          {topByCompany.length === 0 ? (
            <Empty>{t("مفيش")}</Empty>
          ) : (
            <table className="data-table">
              <thead><tr><th>{t("الشركة")}</th><th>{t("اترفضوا")}</th><th>{t("أكتر سبب")}</th></tr></thead>
              <tbody>
                {topByCompany.map((c) => (
                  <tr key={c.company}>
                    <td className="font-semibold">{c.company}</td>
                    <td className="num">{c.total}</td>
                    <td className="text-sm">{reasonLabel(c.top)} <span className="num text-zinc-500">({c.topN})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {a.by_team.length > 0 && (
        <section className="mt-6">
          <h2 className="card-title"><Users size={18} className="text-zinc-500" /> {t("مقارنة التيمز")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {a.by_team.map((row) => (
              <div key={row.id} className="card">
                <p className="font-bold">{row.name}</p>
                <p className="mt-1 text-xs text-zinc-500">{row.agents} {t("أجنت")}</p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="num text-2xl font-semibold">{row.leads}</p>
                    <p className="text-xs text-zinc-500">{t("ليد")}</p>
                  </div>
                  <div className="text-end">
                    <p className="num text-2xl font-semibold text-emerald-700">{row.hired}</p>
                    <p className="text-xs text-zinc-500">{t("اشتغل ·")} {pct(row.hired, row.leads)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
