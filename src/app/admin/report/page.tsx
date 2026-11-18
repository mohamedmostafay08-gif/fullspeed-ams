import Link from "next/link";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, PhoneCall, TrendingUp, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { PrintButton } from "@/components/print-button";
import { CompanyLogo, Empty, StatCard } from "@/components/ui";
import { cairoToday, requireRole, STAFF } from "@/lib/auth";
import type { BoardRow } from "@/lib/badges";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Analytics = {
  totals: { leads: number; contacted: number; no_answer: number; rejected: number; unassigned: number };
  hired: number;
  avg_hours_first_touch: number | null;
  by_company: { id: string; name: string; logo: string | null; leads: number; contacted: number; rejected: number; hired: number }[];
  by_agent: { id: string; contacted: number; no_answer: number; first_touch_hours: number | null; break_minutes: number }[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (d: string, days: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export default async function DailyReportPage({ searchParams }: PageProps<"/admin/report">) {
  const t = await getT();
  await requireRole(...STAFF);
  const today = cairoToday();
  const asked = String((await searchParams).date ?? "");
  const day = DATE_RE.test(asked) && asked <= today ? asked : today;
  const supabase = await createClient();
  const [aRes, bRes] = await Promise.all([
    supabase.rpc("acquisition_analytics", { p_from: day, p_to: day }),
    supabase.rpc("leaderboard", { p_from: day, p_to: day }),
  ]);
  const a = aRes.data as Analytics | null;
  const board = ((bRes.data ?? []) as BoardRow[]).filter((r) => r.points > 0 || r.leads > 0);
  const extra = new Map((a?.by_agent ?? []).map((r) => [r.id, r]));
  const calls = board.reduce((s, r) => s + r.calls, 0);
  const interviews = board.reduce((s, r) => s + r.interviews, 0);
  const hours = (h: number | null) => (h == null ? "—" : h < 1 ? t("{0} د", Math.round(h * 60)) : t("{0} س", Math.round(h * 10) / 10));

  return (
    <>
      <PageHeader title={t("التقرير اليومي")} subtitle={t("ملخص يوم {0} — بيتبعت أوتوماتيك الساعة 9 بالليل", day)}>
        <div className="no-print flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          <Link href={`/admin/report?date=${shift(day, -1)}`} className="btn-ghost px-2.5" aria-label={t("اليوم اللي قبله")}><ChevronRight size={17} className="ltr:rotate-180" /></Link>
          <form className="flex min-w-0 flex-1 gap-1">
            <input type="date" name="date" defaultValue={day} max={today} className="input py-2 sm:w-auto" aria-label={t("التاريخ")} />
            <button className="btn-ghost"><CalendarDays size={16} /></button>
          </form>
          {day < today && <Link href={`/admin/report?date=${shift(day, 1)}`} className="btn-ghost px-2.5" aria-label={t("اليوم اللي بعده")}><ChevronLeft size={17} className="ltr:rotate-180" /></Link>}
        </div>
        <PrintButton />
      </PageHeader>

      {!a ? (
        <Empty>{t("مفيش بيانات لليوم ده")}</Empty>
      ) : (
        <div className="space-y-6">
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={t("ليدز جديدة")} value={a.totals.leads} icon={UserPlus} hint={t("{0} مش متوزعين", a.totals.unassigned)} />
            <StatCard label={t("مكالمات")} value={calls} icon={PhoneCall} hint={t("أول رد في المتوسط: {0}", hours(a.avg_hours_first_touch))} />
            <StatCard label={t("مقابلات")} value={interviews} icon={CalendarDays} tone="warn" />
            <StatCard label={t("اشتغلوا")} value={a.hired} icon={CheckCircle2} tone="good" />
            <StatCard label={t("نسبة التحويل")} value={pct(a.hired, a.totals.leads)} icon={TrendingUp} tone="brand" />
          </div>

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
                      <th>{t("مردوش")}</th><th>{t("مقابلات")}</th><th>{t("اشتغلوا")}</th><th>{t("أول رد")}</th><th>{t("البريك")}</th>
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
