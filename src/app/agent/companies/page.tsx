import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { CompanyTerms } from "@/components/company-terms";
import { CompanyLogo, Empty, Progress } from "@/components/ui";
import { cairoToday, requireRole } from "@/lib/auth";
import { getAssignedCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type PerfRow = { company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };

/** «شركاتي»: each assigned company with today's progress, live bonuses and the offer terms. Moved off the agent home. */
export default async function AgentCompaniesPage() {
  const t = await getT();
  const profile = await requireRole("agent");
  const today = cairoToday();
  const supabase = await createClient();
  const [companies, perfRes, annRes] = await Promise.all([
    getAssignedCompanies(profile.id),
    supabase.rpc("performance_report", { p_from: today, p_to: today, p_agent: profile.id }),
    supabase
      .from("company_announcements")
      .select("id, company_id, type, title, body, amount, valid_to")
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const byCompany = new Map(((perfRes.data ?? []) as PerfRow[]).map((r) => [r.company_id, r]));
  const announcements = annRes.data ?? [];

  return (
    <>
      <PageHeader title={t("شركاتي")} subtitle={t("الشروط والبونص وهدف النهارده لكل شركة")} />
      {companies.length === 0 ? (
        <Empty>{t("لسه متعينتش على شركات — كلم التيم ليدر")}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {companies.map((c) => {
            const p = byCompany.get(c.id);
            const anns = announcements.filter((a) => a.company_id === c.id).slice(0, 2);
            return (
              <article key={c.id} className="card flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <CompanyLogo name={c.name} src={c.logo_path} size={46} />
                  <p className="flex-1 font-bold">{c.name}</p>
                  <Link href={`/agent/leads/new?company=${c.id}`} className="btn-ghost btn-sm">
                    <Plus size={14} /> {t("ليد")}
                  </Link>
                </div>
                <dl className="space-y-2 text-xs text-zinc-500">
                  <div><dt className="mb-1">{t("ليدز")}</dt><dd><Progress value={Number(p?.leads_count ?? 0)} target={p?.target_leads ?? 0} /></dd></div>
                  <div><dt className="mb-1">{t("اشتغلوا")}</dt><dd><Progress value={Number(p?.hired_count ?? 0)} target={p?.target_hired ?? 0} /></dd></div>
                </dl>
                {anns.map((a) => (
                  <div
                    key={a.id}
                    className={`flex gap-2.5 rounded-xl p-3 text-sm ${a.type === "bonus" ? "bg-emerald-50 text-emerald-900" : a.type === "rate" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}
                  >
                    <Gift size={16} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold">
                        {a.title}
                        {a.amount != null && <span className="num"> — {a.amount} {t("ج.م")}</span>}
                      </p>
                      {a.body && <p className="mt-0.5 text-xs opacity-80">{a.body}</p>}
                      {a.valid_to && <p className="mt-0.5 text-[11px] opacity-60">{t("ساري لحد")} {a.valid_to}</p>}
                    </div>
                  </div>
                ))}
                <CompanyTerms terms={c} compact />
                {c.description && <p className="text-xs leading-5 text-zinc-500">{c.description}</p>}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
