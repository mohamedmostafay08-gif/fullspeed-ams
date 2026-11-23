import Link from "next/link";
import { CalendarDays, CheckCircle2, FileSpreadsheet, ChevronLeft, ChevronRight, PhoneCall, TrendingUp, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { TrendChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { CompanyLogo, Empty, StatCard } from "@/components/ui";
import { cairoToday, requireRole, VIEWERS } from "@/lib/auth";
import type { BoardRow } from "@/lib/badges";
import { getT } from "@/lib/i18n/server";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { afArgs, afQuery, anyFilter, readAnalyticsFilters } from "@/lib/analytics-filters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Period = "day" | "week" | "month";
type Analytics = {
  by_day?: { day: string; leads: number; hired: number }[];
  totals: { leads: number; contacted: number; no_answer: number; rejected: number; unassigned: number };
  hired: number;
  avg_hours_first_touch: number | null;
  by_company: { id: string; name: string; logo: string | null; leads: number; contacted: number; rejected: number; hired: number }[];
  by_agent: { id: string; contacted: number; no_answer: number; first_touch_hours: number | null; break_minutes: number }[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** [from, to, prevFrom, prevTo] — weeks run Saturday → Friday. */
function range(period: Period, d: string): [string, string, string, string] {
  if (period === "day") return [d, d, shift(d, -1), shift(d, -1)];
  if (period === "week") {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
    const start = shift(d, -((dow + 1) % 7));
    return [start, shift(start, 6), shift(start, -7), shift(start, -1)];
  }
  const start = `${d.slice(0, 7)}-01`;
  const end = shift(`${shift(start, 32).slice(0, 7)}-01`, -1);
  const prevEnd = shift(start, -1);
  return [start, end, `${prevEnd.slice(0, 7)}-01`, prevEnd];
}

const shift = (d: string, days: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export default async function DailyReportPage({ searchParams }: PageProps<"/admin/report">) {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  const today = cairoToday();
  const asked = String((await searchParams).date ?? "");
  const day = DATE_RE.test(asked) && asked <= today ? asked : today;
  const sp = await searchParams;
  const period: Period = sp.period === "week" || sp.period === "month" ? sp.period : "day";
  const anchor = day;
  const [from, to, prevFrom, prevTo] = range(period, anchor);
  const supabase = await createClient();
  const db = me.role === "performance" ? createAdminClient() : supabase;
  const af = readAnalyticsFilters(sp);
  const fq = afQuery(af);
  const analytics = async (f: string, t2: string) => {
    const r = await db.rpc("analytics_filtered", { p_from: f, p_to: t2, ...afArgs(af) });
    // Before the filtered function exists in the database, fall back to the unfiltered one.
    return r.error && !anyFilter(af) ? db.rpc("acquisition_analytics", { p_from: f, p_to: t2 }) : r;
  };
  const [aRes, bRes, pRes, pbRes, talkRes, teamsRes, companiesRes, agentsRes, govRes] = await Promise.all([
    analytics(from, to),
    supabase.rpc("leaderboard", { p_from: from, p_to: to }),
    analytics(prevFrom, prevTo),
    supabase.rpc("leaderboard", { p_from: prevFrom, p_to: prevTo }),
    db.rpc("talk_time", { p_from: from, p_to: to }),
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("governorates").select("id, name_ar").order("id"),
  ]);
  // The ranking is per agent, so only the team and agent filters narrow it.
  const inScope = (r: BoardRow) => (!af.team || r.team_id === af.team) && (!af.agent || r.agent_id === af.agent);
  const a = aRes.data as Analytics | null;
  const prev = pRes.data as Analytics | null;
  const board = ((bRes.data ?? []) as BoardRow[]).filter((r) => (r.points > 0 || r.leads > 0) && inScope(r));
  const prevBoard = ((pbRes.data ?? []) as BoardRow[]).filter(inScope);
  const talk = new Map(((talkRes.data ?? []) as { agent_id: string; minutes: number }[]).map((r) => [r.agent_id, r.minutes]));
  const extra = new Map((a?.by_agent ?? []).map((r) => [r.id, r]));
  const calls = board.reduce((s, r) => s + r.calls, 0);
  const interviews = board.reduce((s, r) => s + r.interviews, 0);
  const prevCalls = prevBoard.reduce((s, r) => s + r.calls, 0);
  const prevInterviews = prevBoard.reduce((s, r) => s + r.interviews, 0);
  const hours = (h: number | null) => (h == null ? "—" : h < 1 ? t("{0} د", Math.round(h * 60)) : t("{0} س", Math.round(h * 10) / 10));
  const delta = (now: number, before: number) => {
    if (!before) return now ? t("جديد عن الفترة اللي قبلها") : t("زي الفترة اللي قبلها");
    const d = Math.round(((now - before) / before) * 100);
    return d === 0 ? t("زي الفترة اللي قبلها") : t("{0} {1}% عن الفترة اللي قبلها", d > 0 ? "▲" : "▼", Math.abs(d));
  };
  const titles: Record<Period, string> = { day: "التقرير اليومي", week: "التقرير الأسبوعي", month: "التقرير الشهري" };
  const link = (pd: Period, d: string) => `/admin/report?period=${pd}&date=${d}${fq ? `&${fq}` : ""}`;
  const step = period === "day" ? 1 : period === "week" ? 7 : 0;
  const prevAnchor = period === "month" ? prevTo : shift(anchor, -step);
  const nextAnchor = period === "month" ? shift(to, 1) : shift(anchor, step);

  return (
    <>
      <PageHeader title={t(titles[period])} subtitle={from === to ? t("ملخص يوم {0}", from) : t("من {0} إلى {1}", from, to)}>
        <div className="no-print scroll-row">
          {(["day", "week", "month"] as Period[]).map((pd) => (
            <Link key={pd} href={link(pd, anchor)} className={`chip ${pd === period ? "chip-active" : ""}`}>{t({ day: "يوم", week: "أسبوع", month: "شهر" }[pd])}</Link>
          ))}
        </div>
        <div className="no-print flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          <Link href={link(period, prevAnchor)} className="btn-ghost px-2.5" aria-label={t("اللي قبله")}><ChevronRight size={17} className="ltr:rotate-180" /></Link>
          <form className="flex min-w-0 flex-1 gap-1">
            <input type="hidden" name="period" value={period} />
            <input type="date" name="date" defaultValue={anchor} max={today} className="input py-2 sm:w-auto" aria-label={t("التاريخ")} />
            <button className="btn-ghost"><CalendarDays size={16} /></button>
          </form>
          {to < today && <Link href={link(period, nextAnchor > today ? today : nextAnchor)} className="btn-ghost px-2.5" aria-label={t("اللي بعده")}><ChevronLeft size={17} className="ltr:rotate-180" /></Link>}
        </div>
        <a href={`/admin/report/export?from=${from}&to=${to}${fq ? `&${fq}` : ""}`} className="no-print btn-ghost"><FileSpreadsheet size={16} /> {t("تصدير Excel")}</a>
        <PrintButton />
      </PageHeader>
      <AnalyticsFilterBar
        path="/admin/report"
        f={af}
        keep={{ period, date: anchor }}
        saved={false}
        teams={(teamsRes.data ?? []).map((x) => ({ id: x.id, name: x.name }))}
        companies={(companiesRes.data ?? []).map((x) => ({ id: x.id, name: x.name }))}
        agents={(agentsRes.data ?? []).map((x) => ({ id: x.id, name: x.full_name }))}
        governorates={(govRes.data ?? []).map((g) => ({ id: g.id, name: g.name_ar }))}
      />

      {!a ? (
        <Empty>{t("مفيش بيانات لليوم ده")}</Empty>
      ) : (
        <div className="space-y-6">
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard emoji="📥" label={t("ليدز جديدة")} value={a.totals.leads} icon={UserPlus} hint={delta(a.totals.leads, prev?.totals.leads ?? 0)} />
            <StatCard emoji="📞" label={t("مكالمات")} value={calls} icon={PhoneCall} hint={delta(calls, prevCalls)} />
            <StatCard emoji="🤝" label={t("مقابلات")} value={interviews} icon={CalendarDays} tone="warn" hint={delta(interviews, prevInterviews)} />
            <StatCard emoji="🎉" label={t("اشتغلوا")} value={a.hired} icon={CheckCircle2} tone="good" hint={delta(a.hired, prev?.hired ?? 0)} />
            <StatCard emoji="📈" label={t("نسبة التحويل")} value={pct(a.hired, a.totals.leads)} icon={TrendingUp} tone="brand" hint={t("أول رد في المتوسط: {0}", hours(a.avg_hours_first_touch))} />
          </div>

          {period !== "day" && a.by_day && (
            <section className="card">
              <h2 className="card-title">{t("يوم بيوم")}</h2>
              <TrendChart data={a.by_day} />
            </section>
          )}

          <section className="card">
            <h2 className="card-title">{t("أداء الأجنتس")}</h2>
            {board.length === 0 ? (
              <Empty>{t("مفيش نشاط")}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th><th>{t("الأجنت")}</th><th>{t("نقط")}</th><th>{t("ليدز")}</th><th>{t("مكالمات")}</th><th>{t("اتكلّموا")}</th>
                      <th>{t("مردوش")}</th><th>{t("مقابلات")}</th><th>{t("اشتغلوا")}</th><th>{t("أول رد")}</th><th>{t("دقايق كلام")}</th><th>{t("البريك")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((r, i) => {
                      const x = extra.get(r.agent_id);
                      return (
                        <tr key={r.agent_id}>
                          <td className="num text-zinc-500">{i + 1}</td>
                          <td className="font-semibold">{r.full_name}{r.streak > 1 && <span className="ms-1.5 text-xs text-orange-600">🔥{r.streak}</span>}</td>
                          <td className="num font-bold">{r.points}</td>
                          <td className="num">{r.leads}</td>
                          <td className="num">{r.calls}</td>
                          <td className="num">{x?.contacted ?? 0}</td>
                          <td className="num">{x?.no_answer ?? 0}</td>
                          <td className="num">{r.interviews}</td>
                          <td className="num font-bold text-emerald-700">{r.hired}</td>
                          <td className="num">{hours(x?.first_touch_hours ?? null)}</td>
                          <td className="num">{talk.get(r.agent_id) ?? 0}</td>
                          <td className="num">{x?.break_minutes ? t("{0} د", Math.round(x.break_minutes)) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">{t("الشركات")}</h2>
            {a.by_company.length === 0 ? (
              <Empty>{t("مفيش نشاط على الشركات في الفترة دي")}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t("الشركة")}</th><th>{t("ليدز")}</th><th>{t("اتكلّموا")}</th><th>{t("اترفضوا")}</th><th>{t("اشتغلوا")}</th><th>{t("التحويل")}</th></tr></thead>
                  <tbody>
                    {a.by_company.map((c) => (
                      <tr key={c.id}>
                        <td><span className="flex items-center gap-2"><CompanyLogo name={c.name} src={c.logo} size={26} />{c.name}</span></td>
                        <td className="num">{c.leads}</td>
                        <td className="num">{c.contacted}</td>
                        <td className="num">{c.rejected}</td>
                        <td className="num font-bold text-emerald-700">{c.hired}</td>
                        <td className="num">{pct(c.hired, c.leads)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
