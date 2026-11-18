import Link from "next/link";
import { BarChart3, Building2, CheckCircle2, Clock, Coffee, Filter, MapPin, PhoneCall, Timer, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { BarList, TrendChart } from "@/components/charts";
import { LiveRefresh } from "@/components/live";
import { CompanyLogo, Empty, StatCard } from "@/components/ui";
import { cairoToday, requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import type { T } from "@/lib/i18n/translate";
import { getT } from "@/lib/i18n/server";

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
const SOURCES: Record<string, string> = {
  manual: "إدخال يدوي",
  facebook: "فيسبوك",
  tiktok: "تيك توك",
  referral: "ترشيح",
  walk_in: "حضور للمقر",
  import: "ملف Excel",
  crm: "CRM",
};
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
  await requireRole(...STAFF);
  const sp = await searchParams;
  const today = cairoToday();
  const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && DATE_RE.test(sp.from) ? sp.from : shift(-29);
  const to = typeof sp.to === "string" && DATE_RE.test(sp.to) && sp.to >= from ? sp.to : today;
  const sortKey = typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : "hired";

  const supabase = await createClient();
  const [{ data, error }, { data: teams }] = await Promise.all([
    supabase.rpc("acquisition_analytics", { p_from: from, p_to: to }),
    supabase.from("teams").select("id, name"),
  ]);
  const presets = [
    { label: t("النهارده"), from: today, to: today },
    { label: t("آخر 7 أيام"), from: shift(-6), to: today },
    { label: t("آخر 30 يوم"), from: shift(-29), to: today },
    { label: t("الشهر ده"), from: `${today.slice(0, 8)}01`, to: today },
    { label: t("آخر 90 يوم"), from: shift(-89), to: today },
  ];
  const header = (
    <PageHeader title={t("تحليلات الأكوزيشن")} subtitle={t("من {0} إلى {1}", from, to)}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Link key={p.label} href={`/admin/analytics?from=${p.from}&to=${p.to}&sort=${sortKey}`} className={`chip ${p.from === from && p.to === to ? "chip-active" : ""}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <form className="flex items-center gap-1.5">
        <input type="hidden" name="sort" value={sortKey} />
        <input type="date" name="from" defaultValue={from} className="input w-auto py-1.5" aria-label={t("من")} />
        <input type="date" name="to" defaultValue={to} className="input w-auto py-1.5" aria-label={t("إلى")} />
        <button className="btn-dark btn-sm">{t("عرض")}</button>
      </form>
    </PageHeader>
  );
  if (error || !data) {
    return (
      <>
        {header}
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
  const qs = `from=${from}&to=${to}`;

  return (
    <>
      <LiveRefresh channel="analytics" />
      {header}

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
        <StatCard label={t("ليدز جديدة")} value={a.totals.leads} icon={UserPlus} hint={t("{0} مش متوزعين", a.totals.unassigned)} />
        <StatCard label={t("اتكلّموا")} value={pct(a.totals.contacted, a.totals.leads)} icon={PhoneCall} tone="brand" hint={t("{0} ليد · {1} مردوش", a.totals.contacted, a.totals.no_answer)} />
        <StatCard label={t("اشتغلوا في الفترة")} value={a.hired} icon={CheckCircle2} tone="good" hint={t("تحويل {0}", pct(a.totals.converted, a.totals.leads))} />
        <StatCard label={t("اترفضوا")} value={a.totals.rejected} icon={Filter} tone="warn" hint={pct(a.totals.rejected, a.totals.leads)} />
        <StatCard label={t("متوسط أول رد")} value={hours(t, a.avg_hours_first_touch)} icon={Timer} hint={t("من التسجيل لأول تغيير حالة")} />
        <StatCard label={t("متوسط وقت التعيين")} value={hours(t, a.avg_hours_to_hire)} icon={Clock} hint={t("بريكات: {0} دقيقة", Math.round(totalBreakMin))} />
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
                <Link key={s} href={`/admin/leads?status=${s}&${qs}`} className="chip">
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
                    <td><Link href={`/admin/agents/${r.id}`} className="font-semibold hover:text-brand-700">{r.full_name}</Link></td>
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
                      <td><Link href={`/admin/companies/${c.id}`} className="flex items-center gap-2 font-semibold"><CompanyLogo name={c.name} src={c.logo} size={26} />{c.name}</Link></td>
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
