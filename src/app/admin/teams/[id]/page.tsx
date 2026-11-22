import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, CheckCircle2, PhoneCall, UserPlus, Users } from "lucide-react";
import { saveTeamCompanies } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { PeriodTabs } from "@/components/period-tabs";
import { CompanyLogo, Empty, StatCard } from "@/components/ui";
import { MANAGERS, STAFF, requireRole } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { asPeriod, loadTeamNumbers, periodRange } from "@/lib/teams";
import { getT } from "@/lib/i18n/server";
import { teamLabel } from "@/lib/types";

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");

export default async function TeamPage({ params, searchParams }: PageProps<"/admin/teams/[id]">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const { id } = await params;
  if (me.role === "team_leader" && me.team_id !== id) redirect(me.team_id ? `/admin/teams/${me.team_id}` : "/admin");
  const isManager = MANAGERS.includes(me.role);
  const period = asPeriod((await searchParams).period);
  const [from, to] = periodRange(period);
  const supabase = await createClient();

  const [{ teams, board, targetByAgent }, companies, teamCompaniesRes, perfRes] = await Promise.all([
    loadTeamNumbers(from, to),
    getCompanies(true),
    supabase.from("team_companies").select("company_id").eq("team_id", id),
    supabase.rpc("performance_report", { p_from: from, p_to: to }),
  ]);
  const team = teams.find((x) => x.id === id);
  if (!team) notFound();
  const members = board.filter((b) => b.team_id === id);
  const memberIds = new Set(members.map((m) => m.agent_id));
  const teamCompanyIds = new Set((teamCompaniesRes.data ?? []).map((r) => r.company_id));

  // Leads, hires and targets per company, counting only this team's agents.
  const byCompany = new Map<string, { leads: number; hired: number; target: number }>();
  for (const r of (perfRes.data ?? []) as { agent_id: string; company_id: string; leads_count: number; hired_count: number; target_hired: number }[]) {
    if (!memberIds.has(r.agent_id)) continue;
    const cur = byCompany.get(r.company_id) ?? { leads: 0, hired: 0, target: 0 };
    cur.leads += Number(r.leads_count);
    cur.hired += Number(r.hired_count);
    cur.target += Number(r.target_hired);
    byCompany.set(r.company_id, cur);
  }
  const companyRows = companies
    .filter((c) => teamCompanyIds.has(c.id) || byCompany.has(c.id))
    .map((c) => ({ c, n: byCompany.get(c.id) ?? { leads: 0, hired: 0, target: 0 } }))
    .sort((a, b) => b.n.hired - a.n.hired || b.n.leads - a.n.leads);

  return (
    <>
      <PageHeader title={teamLabel(team.name, t)} subtitle={t("التيم ليدر: {0} · {1} أجنت", team.leader ?? "—", team.agents)}>
        <PeriodTabs current={period} href={(p) => `/admin/teams/${id}?period=${p}`} />
        {(isManager || me.role === "team_leader") && <Link href="/admin/agents" className="btn-ghost"><UserPlus size={16} /> {t("إضافة أجنت")}</Link>}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("الليدز")} value={team.leads} icon={Users} hint={team.targetLeads ? t("من تارجت {0}", team.targetLeads) : undefined} />
        <StatCard label={t("المكالمات")} value={team.calls} icon={PhoneCall} />
        <StatCard label={t("المقابلات")} value={team.interviews} tone="warn" />
        <StatCard label={t("اشتغلوا")} value={team.hired} icon={CheckCircle2} tone="good" hint={team.targetHired ? t("{0} من التارجت ({1})", pct(team.hired, team.targetHired), team.targetHired) : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="card md:overflow-x-auto">
          <h2 className="card-title"><Users size={18} className="text-brand-600" /> {t("الأجنتس")}</h2>
          {members.length === 0 ? (
            <Empty>{t("مفيش أجنتس في التيم لسه")}</Empty>
          ) : (
            <table className="data-table">
              <thead><tr><th>{t("الأجنت")}</th><th>{t("الليدز")}</th><th>{t("المكالمات")}</th><th>{t("المقابلات")}</th><th>{t("اشتغلوا")}</th><th>{t("التارجت")}</th><th>{t("النقط")}</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.agent_id}>
                    <td className="font-semibold"><Link href={`/admin/agents/${m.agent_id}`} className="hover:underline">{m.full_name}</Link></td>
                    <td className="num">{m.leads}</td>
                    <td className="num">{m.calls}</td>
                    <td className="num">{m.interviews}</td>
                    <td className="num font-bold text-emerald-700">{m.hired}</td>
                    <td className="num">{targetByAgent.get(m.agent_id)?.hired || "—"}</td>
                    <td className="num">{m.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card md:overflow-x-auto">
          <h2 className="card-title"><Building2 size={18} className="text-teal-600" /> {t("الشركات")}</h2>
          {companyRows.length === 0 ? (
            <Empty>{t("التيم لسه ملوش شركات")}</Empty>
          ) : (
            <table className="data-table">
              <thead><tr><th>{t("الشركة")}</th><th>{t("الليدز")}</th><th>{t("اشتغلوا")}</th><th>{t("التارجت")}</th><th>{t("المحقق")}</th></tr></thead>
              <tbody>
                {companyRows.map(({ c, n }) => (
                  <tr key={c.id}>
                    <td><span className="flex items-center gap-2 font-semibold"><CompanyLogo name={c.name} src={c.logo_path} size={24} /> {c.name}</span></td>
                    <td className="num">{n.leads}</td>
                    <td className="num font-bold text-emerald-700">{n.hired}</td>
                    <td className="num">{n.target || "—"}</td>
                    <td className="num">{pct(n.hired, n.target)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {isManager && (
        <section className="card mt-6">
          <h2 className="card-title"><Building2 size={18} className="text-zinc-500" /> {t("شركات التيم")}</h2>
          <p className="mb-3 text-sm text-zinc-500">{t("التيم ليدر بيوزّع الشركات دي على أجنتس التيم. لو شلت شركة، بتتشال من أجنتس التيم كمان.")}</p>
          <form action={saveTeamCompanies} className="space-y-3">
            <input type="hidden" name="team_id" value={id} />
            <div className="grid max-h-96 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-zinc-50">
                  <input type="checkbox" name="company_id" value={c.id} defaultChecked={teamCompanyIds.has(c.id)} className="accent-brand-600" />
                  <CompanyLogo name={c.name} src={c.logo_path} size={24} />
                  {c.name}
                </label>
              ))}
            </div>
            <button className="btn-primary">{t("حفظ شركات التيم")}</button>
          </form>
        </section>
      )}
    </>
  );
}
