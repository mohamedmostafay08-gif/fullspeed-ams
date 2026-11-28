import Link from "next/link";
import { Megaphone, Target, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { REPORT_TABS, SubTabs } from "@/components/sub-tabs";
import { Empty, StatCard } from "@/components/ui";
import { cairoToday, requireRole, VIEWERS } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { LEAD_SOURCES } from "@/lib/types";

type Row = { leads: number; reached: number; interview: number; documents: number; hired: number; rejected: number; median_first_min: number | null };
type Ad = Row & { ad: string; source: string };
type Campaign = Row & { campaign: string; ads: Ad[] };
type Funnel = { from: string; to: string; total: { leads: number; hired: number }; campaigns: Campaign[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Per campaign and ad: how many leads came, were reached, interviewed and hired (LineCRM's ad funnel, with our own outcomes). */
export default async function CampaignsPage({ searchParams }: PageProps<"/admin/campaigns">) {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = cairoToday();
  const to = DATE_RE.test(one("to")) ? one("to") : today;
  const from = DATE_RE.test(one("from")) ? one("from") : shift(to, -29);
  const company = UUID_RE.test(one("company")) ? one("company") : "";

  const supabase = await createClient();
  const [{ data, error }, { data: companies }] = await Promise.all([
    supabase.rpc("campaign_funnel", { p_from: from, p_to: to, p_company: company || null }),
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (error || !data) {
    return (
      <>
        <PageHeader title={t("مسار الحملات")} />
        <SubTabs tabs={REPORT_TABS} current="/admin/campaigns" />
        <Empty>{t("الصفحة دي محتاجة migration 0051 — اتأكد إنه اتطبق في Supabase")}</Empty>
      </>
    );
  }
  const f = data as Funnel;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const mins = (m: number | null) => (m === null || m === undefined ? "—" : m < 60 ? t("{0} د", m) : t("{0} س {1} د", Math.floor(m / 60), m % 60));
  const named = f.campaigns.filter((c) => c.campaign !== "—");
  const best = [...named].filter((c) => c.leads >= 10).sort((a, b) => b.hired / b.leads - a.hired / a.leads)[0];
  const canOpenLeads = me.role !== "performance";
  const leadsLink = (campaign: string) =>
    `/admin/leads?${new URLSearchParams({ campaign, from, to, ...(company ? { company } : {}) }).toString()}`;

  const cells = (r: Row) => (
    <>
      <td className="num p-2 font-semibold">{r.leads}</td>
      <td className="num p-2">{r.reached} <span className="text-xs text-zinc-400">{pct(r.reached, r.leads)}</span></td>
      <td className="num p-2">{r.interview} <span className="text-xs text-zinc-400">{pct(r.interview, r.leads)}</span></td>
      <td className="num p-2">{r.documents}</td>
      <td className="num p-2 font-semibold text-emerald-700">{r.hired} <span className="text-xs font-normal text-zinc-400">{pct(r.hired, r.leads)}</span></td>
      <td className="num p-2 text-rose-700">{r.rejected}</td>
      <td className="num p-2">{mins(r.median_first_min)}</td>
    </>
  );

  return (
    <>
      <PageHeader title={t("مسار الحملات")} subtitle={t("كل حملة وإعلان: جاب كام ليد، اتكلمنا مع كام، وكام عمل مقابلة واشتغل")}>
        <form className="flex flex-wrap items-end gap-2">
          <input type="date" name="from" defaultValue={from} className="input py-1.5" aria-label={t("من")} />
          <input type="date" name="to" defaultValue={to} className="input py-1.5" aria-label={t("إلى")} />
          <select name="company" defaultValue={company} className="input py-1.5" aria-label={t("الشركة")}>
            <option value="">{t("كل الشركات")}</option>
            {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-primary py-1.5">{t("عرض")}</button>
        </form>
      </PageHeader>
      <SubTabs tabs={REPORT_TABS} current="/admin/campaigns" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("ليدز في الفترة")} value={f.total.leads} icon={Megaphone} hint={t("{0} حملة باسمها", named.length)} />
        <StatCard label={t("اشتغلوا")} value={f.total.hired} icon={UserCheck} tone="good" hint={pct(f.total.hired, f.total.leads)} />
        <StatCard label={t("أحسن حملة (10 ليدز أو أكتر)")} value={best ? pct(best.hired, best.leads) : "—"} icon={Target} hint={best?.campaign ?? t("لسه مفيش")} />
      </div>

      <section className="card overflow-x-auto">
        {f.campaigns.length === 0 ? (
          <Empty>{t("مفيش ليدز في الفترة دي")}</Empty>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="p-2 text-start">{t("الحملة / الإعلان")}</th>
                <th className="p-2 text-start">{t("ليدز")}</th>
                <th className="p-2 text-start">{t("اتكلمنا معاه")}</th>
                <th className="p-2 text-start">{t("مقابلة")}</th>
                <th className="p-2 text-start">{t("أوراق")}</th>
                <th className="p-2 text-start">{t("اشتغل")}</th>
                <th className="p-2 text-start">{t("اترفض")}</th>
                <th className="p-2 text-start">{t("وسيط أول تواصل")}</th>
              </tr>
            </thead>
            {f.campaigns.map((c) => (
              <tbody key={c.campaign} className="border-t-2 border-zinc-100">
                <tr className="bg-zinc-50/60">
                  <td className="p-2 font-semibold">
                    {c.campaign === "—" ? (
                      <span className="text-zinc-500">{t("من غير حملة")}</span>
                    ) : canOpenLeads ? (
                      <Link href={leadsLink(c.campaign)} className="hover:underline">{c.campaign}</Link>
                    ) : (
                      c.campaign
                    )}
                  </td>
                  {cells(c)}
                </tr>
                {c.ads.length > 1 || (c.ads[0] && c.ads[0].ad !== "—")
                  ? c.ads.map((a) => (
                      <tr key={`${a.ad}-${a.source}`} className="text-zinc-600">
                        <td className="p-2 ps-6 text-xs">
                          {a.ad === "—" ? t("من غير إعلان") : a.ad}
                          <span className="ms-1 text-zinc-400">· {t(LEAD_SOURCES[a.source] ?? a.source)}</span>
                        </td>
                        {cells(a)}
                      </tr>
                    ))
                  : null}
              </tbody>
            ))}
          </table>
        )}
      </section>
    </>
  );
}
