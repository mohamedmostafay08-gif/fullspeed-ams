import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, GitCompareArrows, Minus, TrendingUp } from "lucide-react";
import { LinesChart, TrendChart } from "@/components/charts";
import { Empty } from "@/components/ui";
import { afArgs, type AnalyticsFilters } from "@/lib/analytics-filters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { T } from "@/lib/i18n/translate";
import { getT } from "@/lib/i18n/server";

type Totals = { leads: number; contacted: number; no_answer: number; rejected: number; unassigned: number; converted: number };
type Result = { totals: Totals; hired: number; avg_hours_first_touch: number | null; avg_hours_to_hire: number | null };
type Week = { week: string; leads: number; contacted: number; rejected: number; hired: number };
type Opt = { id: string; name: string };
export type CompareDim = "agent" | "team" | "company" | "source";

const DIMS: Record<CompareDim, string> = { agent: "أجنتس", team: "تيمات", company: "شركات", source: "مصادر" };
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const rate = (n: number, d: number) => (d ? (100 * n) / d : null);

/** Every number we compare, how to read it from a result, and whether higher is better. */
const METRICS: { key: string; emoji: string; label: string; get: (r: Result) => number | null; kind: "count" | "rate" | "hours"; lowerBetter?: boolean }[] = [
  { key: "leads", emoji: "📥", label: "ليدز جديدة", get: (r) => r.totals.leads, kind: "count" },
  { key: "contact", emoji: "💬", label: "نسبة التواصل", get: (r) => rate(r.totals.contacted, r.totals.leads), kind: "rate" },
  { key: "hired", emoji: "🎉", label: "اشتغلوا", get: (r) => r.hired, kind: "count" },
  { key: "conversion", emoji: "📈", label: "نسبة التحويل", get: (r) => rate(r.totals.converted, r.totals.leads), kind: "rate" },
  { key: "rejected", emoji: "🚫", label: "نسبة الرفض", get: (r) => rate(r.totals.rejected, r.totals.leads), kind: "rate", lowerBetter: true },
  { key: "noanswer", emoji: "📵", label: "نسبة مردش", get: (r) => rate(r.totals.no_answer, r.totals.leads), kind: "rate", lowerBetter: true },
  { key: "first", emoji: "⚡", label: "متوسط أول رد", get: (r) => r.avg_hours_first_touch, kind: "hours", lowerBetter: true },
  { key: "tohire", emoji: "⏱️", label: "متوسط وقت التعيين", get: (r) => r.avg_hours_to_hire, kind: "hours", lowerBetter: true },
];

function fmt(t: T, kind: "count" | "rate" | "hours", v: number | null) {
  if (v == null) return "—";
  if (kind === "rate") return `${Math.round(v)}%`;
  if (kind === "hours") return v < 1 ? t("{0} د", Math.round(v * 60)) : v < 48 ? t("{0} س", Math.round(v * 10) / 10) : t("{0} يوم", Math.round(v / 24));
  return String(Math.round(v));
}

/** Change against the previous period: percent for counts and times, points for rates. */
function Delta({ t, kind, now, before, lowerBetter }: { t: T; kind: "count" | "rate" | "hours"; now: number | null; before: number | null; lowerBetter?: boolean }) {
  if (now == null || before == null) return <span className="text-xs text-zinc-400">{t("مفيش مقارنة")}</span>;
  const diff = kind === "rate" ? now - before : before === 0 ? (now === 0 ? 0 : 100) : (100 * (now - before)) / before;
  if (Math.abs(diff) < 0.5) return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Minus size={13} /> {t("زي ما هو")}</span>;
  const good = diff > 0 !== Boolean(lowerBetter);
  const text = kind === "rate" ? t("{0} نقطة", Math.abs(Math.round(diff))) : `${Math.abs(Math.round(diff))}%`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {diff > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} {diff > 0 ? t("زيادة {0}", text) : t("نقص {0}", text)}
    </span>
  );
}

export async function AnalyticsCompare({
  from, to, f, asServer, dim, ids, options, path, keep,
}: {
  from: string;
  to: string;
  f: AnalyticsFilters;
  asServer: boolean;
  dim: CompareDim;
  ids: string[];
  options: Record<CompareDim, Opt[]>;
  path: string;
  keep: Record<string, string>;
}) {
  const t = await getT();
  const db = asServer ? createAdminClient() : await createClient();
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const pick = (id: string): AnalyticsFilters => ({ ...f, [dim === "source" ? "source" : dim]: id });

  const [nowRes, prevRes, weeksRes, ...entityRes] = await Promise.all([
    db.rpc("analytics_filtered", { p_from: from, p_to: to, ...afArgs(f) }),
    db.rpc("analytics_filtered", { p_from: prevFrom, p_to: prevTo, ...afArgs(f) }),
    db.rpc("analytics_weekly", { p_to: to, p_weeks: 12, ...afArgs(f) }),
    ...ids.flatMap((id) => [
      db.rpc("analytics_filtered", { p_from: from, p_to: to, ...afArgs(pick(id)) }),
      db.rpc("analytics_weekly", { p_to: to, p_weeks: 8, ...afArgs(pick(id)) }),
    ]),
  ]);
  if (nowRes.error || !nowRes.data) {
    return <section className="card"><Empty icon={TrendingUp}>{t("المقارنات محتاجة تحديث قاعدة البيانات الأخير — كلّم الأدمن")}</Empty></section>;
  }
  const now = nowRes.data as Result;
  const prev = prevRes.data as Result | null;
  const weeks = (weeksRes.data ?? []) as Week[];
  const entities = ids.map((id, i) => ({
    id,
    name: options[dim].find((o) => o.id === id)?.name ?? id,
    result: entityRes[i * 2]?.data as Result | null,
    weeks: (entityRes[i * 2 + 1]?.data ?? []) as Week[],
  }));
  const link = (nextDim: CompareDim, nextIds: string[]) => {
    const p = new URLSearchParams({ ...keep, cmp: nextDim });
    if (nextIds.length) p.set("ids", nextIds.join(","));
    return `${path}?${p}`;
  };

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="card-title"><TrendingUp size={18} className="text-brand-600" /> {t("الفترة دي قدام اللي قبلها")}</h2>
        <p className="mb-4 text-sm text-zinc-500">{t("من {0} إلى {1}، مقارنة بنفس عدد الأيام قبلها ({2} → {3}).", from, to, prevFrom, prevTo)}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {METRICS.map((m) => {
            const v = m.get(now);
            const b = prev ? m.get(prev) : null;
            return (
              <div key={m.key} className="rounded-2xl border border-(--glass-line) bg-(--glass-strong) p-4">
                <p className="text-sm text-zinc-500">{m.emoji} {t(m.label)}</p>
                <p className="num mt-1 text-2xl font-extrabold">{fmt(t, m.kind, v)}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("قبلها: {0}", fmt(t, m.kind, b))}</p>
                <div className="mt-1"><Delta t={t} kind={m.kind} now={v} before={b} lowerBetter={m.lowerBetter} /></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title"><TrendingUp size={18} className="text-zinc-500" /> {t("ترند آخر 12 أسبوع")}</h2>
        {weeks.length === 0 ? (
          <Empty>{t("مفيش بيانات")}</Empty>
        ) : (
          <>
            <TrendChart data={weeks.map((w) => ({ day: w.week, leads: w.leads, hired: w.hired }))} />
            <div className="mt-4 overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t("الأسبوع اللي بيبدأ")}</th><th>{t("ليدز")}</th><th>{t("نسبة التواصل")}</th><th>{t("اشتغلوا")}</th><th>{t("نسبة التحويل")}</th><th>{t("نسبة الرفض")}</th></tr></thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.week}>
                      <td className="num">{w.week}</td>
                      <td className="num">{w.leads}</td>
                      <td className="num">{fmt(t, "rate", rate(w.contacted, w.leads))}</td>
                      <td className="num font-bold text-emerald-700">{w.hired}</td>
                      <td className="num">{fmt(t, "rate", rate(w.hired, w.leads))}</td>
                      <td className="num">{fmt(t, "rate", rate(w.rejected, w.leads))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card-title"><GitCompareArrows size={18} className="text-brand-600" /> {t("قارن جنب بعض")}</h2>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(Object.keys(DIMS) as CompareDim[]).map((d) => (
            <Link key={d} href={link(d, [])} className={`chip ${d === dim ? "chip-active" : ""}`}>{t(DIMS[d])}</Link>
          ))}
        </div>
        <form className="mb-4 space-y-3">
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="cmp" value={dim} />
          <p className="text-sm text-zinc-500">{t("اختار من 2 لـ 4 عشان تقارنهم:")}</p>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {options[dim].map((o) => (
              <label key={o.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-(--glass-strong)">
                <input type="checkbox" name="pick" value={o.id} defaultChecked={ids.includes(o.id)} className="accent-brand-600" /> {o.name}
              </label>
            ))}
          </div>
          <button className="btn-primary"><GitCompareArrows size={16} /> {t("قارن")}</button>
        </form>

        {entities.length < 2 ? (
          <Empty icon={GitCompareArrows}>{t("اختار اتنين على الأقل")}</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t("المقياس")}</th>{entities.map((e) => <th key={e.id}>{e.name}</th>)}</tr></thead>
                <tbody>
                  {METRICS.map((m) => {
                    const vals = entities.map((e) => (e.result ? m.get(e.result) : null));
                    const nums = vals.filter((v): v is number => v != null);
                    const best = nums.length ? (m.lowerBetter ? Math.min(...nums) : Math.max(...nums)) : null;
                    return (
                      <tr key={m.key}>
                        <td className="font-semibold">{m.emoji} {t(m.label)}</td>
                        {vals.map((v, i) => (
                          <td key={entities[i].id} className={`num ${v != null && v === best && nums.length > 1 ? "font-extrabold text-emerald-700" : ""}`}>
                            {fmt(t, m.kind, v)} {v != null && v === best && nums.length > 1 ? "🏆" : ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-bold text-zinc-600">{t("التعيينات أسبوع بأسبوع (آخر 8 أسابيع)")}</h3>
              <LinesChart labels={entities[0].weeks.map((w) => w.week)} series={entities.map((e) => ({ name: e.name, values: e.weeks.map((w) => w.hired) }))} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
