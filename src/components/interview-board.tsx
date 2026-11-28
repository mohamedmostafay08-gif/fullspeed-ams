import Link from "next/link";
import { InterviewResult } from "@/components/interview-result";
import { CompanyLogo, Empty } from "@/components/ui";
import { cairoRange, cairoToday } from "@/lib/auth";
import { getLocale, getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cairoDateTime, cairoTime } from "@/lib/time";

type Row = {
  id: string; full_name: string; phone: string; interview_at: string; interview_place: string | null; no_show_count: number;
  company_id: string; companies: { name: string; logo_path: string | null } | null; agent: { full_name: string } | null;
};
type Stat = { company_id: string; company: string; held: number; attended: number; no_show: number; waiting: number };

const VIEWS = [
  { key: "today", label: "النهارده" },
  { key: "tomorrow", label: "بكرة" },
  { key: "week", label: "الأسبوع ده" },
  { key: "needs", label: "محتاجة نتيجة" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Interviews grouped by company and place, with came / didn't come / moved on each one. RLS decides whose leads show. */
export async function InterviewBoard({ base, sp, staff, agentId, readOnly = false }: { base: string; sp: Record<string, string | string[] | undefined>; staff: boolean; agentId?: string; readOnly?: boolean }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "today";
  const company = typeof sp.company === "string" && /^[0-9a-f-]{36}$/i.test(sp.company) ? sp.company : "";
  const today = cairoToday();
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  let q = supabase
    .from("leads")
    .select("id, full_name, phone, interview_at, interview_place, no_show_count, company_id, companies(name, logo_path), agent:profiles!leads_agent_id_fkey(full_name)")
    .eq("status", "interview")
    .not("interview_at", "is", null)
    .order("interview_at")
    .limit(500);
  if (view === "needs") q = q.lt("interview_at", nowIso).or("interview_result.is.null,interview_result.eq.rescheduled");
  else {
    const [from, to] = view === "today" ? cairoRange(today, today) : view === "tomorrow" ? cairoRange(addDays(today, 1), addDays(today, 1)) : cairoRange(today, addDays(today, 6));
    q = q.gte("interview_at", from).lt("interview_at", to);
  }
  if (company) q = q.eq("company_id", company);
  if (agentId) q = q.eq("agent_id", agentId);
  let needsQ = supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "interview").lt("interview_at", nowIso).or("interview_result.is.null,interview_result.eq.rescheduled");
  if (agentId) needsQ = needsQ.eq("agent_id", agentId);

  const [rowsRes, needsRes, statsRes, { data: companies }] = await Promise.all([
    q,
    needsQ,
    staff ? supabase.rpc("interview_stats", { p_from: addDays(today, -29), p_to: today }) : Promise.resolve({ data: null, error: null }),
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
  ]);

  if (rowsRes.error) {
    return <Empty>{t("الصفحة دي محتاجة migration 0062 — اتأكد إنه اتطبق في Supabase")}</Empty>;
  }
  const rows = (rowsRes.data ?? []) as unknown as Row[];
  const needs = needsRes.count ?? 0;
  const stats = (statsRes.data ?? []) as Stat[];

  // Company → place → interviews.
  const groups = new Map<string, { name: string; logo: string | null; places: Map<string, Row[]> }>();
  for (const r of rows) {
    const g = groups.get(r.company_id) ?? { name: r.companies?.name ?? "—", logo: r.companies?.logo_path ?? null, places: new Map() };
    const place = r.interview_place?.trim() || t("مكان مش متحدد");
    g.places.set(place, [...(g.places.get(place) ?? []), r]);
    groups.set(r.company_id, g);
  }
  const link = (patch: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(view !== "today" ? { view } : {}), ...(company ? { company } : {}), ...patch });
    for (const [k, v] of [...qs.entries()]) if (!v || (k === "view" && v === "today")) qs.delete(k);
    const s = qs.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const leadHref = (id: string) => `${staff ? "/admin" : "/agent"}/leads/${id}`;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={link({ view: v.key })} aria-current={v.key === view ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${v.key === view ? "bg-white text-(--fg) shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
              {t(v.label)}
              {v.key === "needs" && needs > 0 && <span className="num ms-1.5 rounded-full bg-rose-600 px-1.5 text-[11px] text-white">{needs}</span>}
            </Link>
          ))}
        </div>
        {staff && (
          <form className="flex items-center gap-2" action={base}>
            {view !== "today" && <input type="hidden" name="view" value={view} />}
            <select name="company" defaultValue={company} className="input w-auto py-1.5 text-sm" aria-label={t("الشركة")}>
              <option value="">{t("كل الشركات")}</option>
              {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn-ghost btn-sm">{t("عرض")}</button>
          </form>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty emoji="📅">{view === "needs" ? t("كل المقابلات اللي فاتت متسجل نتيجتها 👌") : t("مفيش مقابلات في الفترة دي")}</Empty>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-500">{t("{0} مقابلة", rows.length)}</p>
          {[...groups.entries()].map(([id, g]) => (
            <section key={id} className="card space-y-3">
              <h2 className="flex items-center gap-2 font-bold">
                <CompanyLogo name={g.name} src={g.logo} size={32} /> {g.name}
                <span className="num text-sm font-normal text-zinc-500">· {[...g.places.values()].reduce((s, l) => s + l.length, 0)}</span>
              </h2>
              {[...g.places.entries()].map(([place, list]) => (
                <div key={place} className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500">📍 {place}</p>
                  <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-100">
                    {list.map((r) => {
                      const past = r.interview_at < nowIso;
                      return (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                          <span className={`num shrink-0 text-sm font-bold ${view === "today" || view === "tomorrow" ? "w-20" : "w-full sm:w-44"} ${past ? "text-rose-700" : ""}`}>
                            {view === "today" || view === "tomorrow" ? cairoTime(r.interview_at, locale) : cairoDateTime(r.interview_at, locale)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link href={leadHref(r.id)} className="font-semibold hover:underline">{r.full_name}</Link>
                            <p className="text-xs text-zinc-500">
                              <span dir="ltr" className="num">{r.phone}</span>
                              {staff && r.agent && ` · ${r.agent.full_name}`}
                              {r.no_show_count > 0 && <span className="text-rose-600"> · {t("مجاش قبل كده {0} مرة", r.no_show_count)}</span>}
                            </p>
                          </div>
                          {!readOnly && <InterviewResult leadId={r.id} compact />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {staff && !statsRes.error && (
        <section className="card">
          <h2 className="card-title">📊 {t("الحضور في آخر 30 يوم")}</h2>
          {stats.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("لسه مفيش نتايج مقابلات متسجلة")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead><tr><th>{t("الشركة")}</th><th>{t("اتعملت")}</th><th>{t("حضر")}</th><th>{t("مجاش")}</th><th>{t("نسبة الحضور")}</th><th>{t("مستنية نتيجة")}</th></tr></thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.company_id}>
                      <td className="font-semibold">{s.company}</td>
                      <td className="num">{s.held}</td>
                      <td className="num text-emerald-700">{s.attended}</td>
                      <td className="num text-rose-700">{s.no_show}</td>
                      <td className="num font-bold">{pct(s.attended, s.held)}</td>
                      <td className="num">{s.waiting}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
