import Link from "next/link";
import { Filter, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { AssignMatrix } from "@/components/assign-matrix";
import { Empty } from "@/components/ui";
import { MANAGERS, requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

const UUID = /^[0-9a-f-]{36}$/i;

/** One grid of agents × companies: tick the boxes and save once. */
export default async function AssignCompaniesPage({ searchParams }: PageProps<"/admin/agents/assign">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const isManager = MANAGERS.includes(me.role);
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  // A team leader always sees their own team.
  const fTeam = !isManager ? (me.team_id ?? "") : UUID.test(str("team")) || str("team") === "none" ? str("team") : "";
  const fQ = str("q").trim().slice(0, 60);
  const showInactive = str("inactive") === "1";

  const supabase = await createClient();
  let agentsQ = supabase.from("profiles").select("id, full_name, team_id, is_active").eq("role", "agent").order("full_name");
  if (fTeam === "none") agentsQ = agentsQ.is("team_id", null);
  else if (fTeam) agentsQ = agentsQ.eq("team_id", fTeam);
  if (!showInactive) agentsQ = agentsQ.eq("is_active", true);

  const [companies, { data: agentsRaw }, { data: teams }, { data: assignments }, { data: teamCompanies }] = await Promise.all([
    getCompanies(true),
    agentsQ,
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("agent_companies").select("agent_id, company_id"),
    supabase.from("team_companies").select("team_id, company_id"),
  ]);
  const ql = fQ.toLowerCase();
  const agents = (agentsRaw ?? []).filter((a) => !fQ || a.full_name.toLowerCase().includes(ql));
  const teamName = new Map((teams ?? []).map((row) => [row.id, row.name]));

  const assigned: Record<string, string[]> = {};
  for (const a of assignments ?? []) (assigned[a.agent_id] ??= []).push(a.company_id);
  const teamCos: Record<string, string[]> = {};
  for (const tc of teamCompanies ?? []) (teamCos[tc.team_id] ??= []).push(tc.company_id);

  // A team leader can only hand out the team's companies.
  const columns = isManager || !me.team_id ? companies : companies.filter((c) => teamCos[me.team_id!]?.includes(c.id));

  return (
    <>
      <PageHeader title={t("توزيع الشركات على الأجنتس")} subtitle={t("علّم على الشركات اللي كل أجنت هيشتغل عليها، وبعدين اضغط حفظ مرة واحدة")}>
        <Link href="/admin/agents" className="btn-ghost">{t("الفريق")}</Link>
      </PageHeader>

      <form className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input name="q" defaultValue={fQ} placeholder={t("اسم الأجنت")} className="input" aria-label={t("بحث")} />
        {isManager ? (
          <select name="team" defaultValue={fTeam} className="input" aria-label={t("التيم")}>
            <option value="">{t("كل التيمات")}</option>
            <option value="none">{t("من غير تيم")}</option>
            {(teams ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        ) : (
          <p className="input bg-zinc-50">{teamName.get(me.team_id ?? "") ?? "—"}</p>
        )}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} className="accent-brand-600" /> {t("اعرض الموقوفين كمان")}
        </label>
        <div className="flex gap-2">
          <button className="btn-primary flex-1"><Filter size={16} /> {t("فلتر")}</button>
          {(fQ || (isManager && fTeam) || showInactive) && <Link href="/admin/agents/assign" className="btn-ghost" aria-label={t("امسح كل الفلاتر")}><X size={16} /></Link>}
        </div>
      </form>

      {!isManager && !me.team_id ? (
        <Empty>{t("إنت مش متعين على تيم")}</Empty>
      ) : agents.length === 0 ? (
        <Empty>{t("مفيش أجنتس بالفلتر ده")}</Empty>
      ) : columns.length === 0 ? (
        <Empty>{isManager ? t("مفيش شركات نشطة") : t("التيم لسه ملوش شركات — اطلب من المدير يضيفها من صفحة التيم")}</Empty>
      ) : (
        <AssignMatrix
          agents={agents.map((a) => ({ id: a.id, name: a.full_name, team: a.team_id ? (teamName.get(a.team_id) ?? null) : null, teamId: a.team_id, active: a.is_active }))}
          companies={columns.map((c) => ({ id: c.id, name: c.name, logo: c.logo_path }))}
          assigned={assigned}
          teamCompanies={teamCos}
          canAddToTeam={isManager}
        />
      )}
    </>
  );
}
