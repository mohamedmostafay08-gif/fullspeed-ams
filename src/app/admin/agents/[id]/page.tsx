import Link from "next/link";
import { notFound } from "next/navigation";
import { saveAssignments, saveTargets, updateUser } from "@/app/admin/actions";
import { requestAccountChange } from "@/app/actions/management";
import { StateForm } from "@/components/state-form";
import { PageHeader } from "@/components/app-shell";
import { CompanyLogo, Empty, Progress, StatCard, formatDate } from "@/components/ui";
import { cairoToday, requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, ROLE_LABELS, TASK_STATUS_LABELS, assignableRoles, canManageRole, type Role, type TaskPriority, type TaskStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AgentPage({ params, searchParams }: PageProps<"/admin/agents/[id]">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const { id } = await params;
  const sp = await searchParams;
  const date = typeof sp.date === "string" && DATE_RE.test(sp.date) ? sp.date : cairoToday();
  const supabase = await createClient();

  const { data: agent } = await supabase.from("profiles").select("id, full_name, phone, role, team_id, is_active, location_id, allow_anywhere").eq("id", id).maybeSingle();
  if (!agent) notFound();

  const weekAgo = new Date(new Date(`${date}T12:00:00Z`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [companies, assignedRes, targetsRes, perfRes, tasksRes, teamsRes, locationsRes] = await Promise.all([
    getCompanies(true),
    supabase.from("agent_companies").select("company_id").eq("agent_id", id),
    supabase.from("daily_targets").select("company_id, target_leads, target_hired").eq("agent_id", id).eq("date", date),
    supabase.rpc("performance_report", { p_from: weekAgo, p_to: date, p_agent: id }),
    supabase.from("tasks").select("id, title, status, priority, due_date").eq("agent_id", id).order("created_at", { ascending: false }).limit(15),
    supabase.from("teams").select("id, name"),
    supabase.from("work_locations").select("id, name").order("name"),
  ]);
  // A manager may ask about team leaders and agents; a team leader about agents in their own team.
  const canRequest =
    agent.id !== me.id &&
    ((me.role === "manager" && canManageRole(me.role, agent.role as Role)) ||
      (me.role === "team_leader" && agent.role === "agent" && !!agent.team_id && agent.team_id === me.team_id));
  const [{ data: pendingRequest }, { data: teamCompanyRows }] = await Promise.all([
    canRequest
      ? supabase.from("admin_requests").select("kind, created_at").eq("target_id", id).eq("status", "pending").maybeSingle()
      : Promise.resolve({ data: null }),
    agent.team_id ? supabase.from("team_companies").select("company_id").eq("team_id", agent.team_id) : Promise.resolve({ data: null }),
  ]);
  // An agent in a team can only work on that team's companies.
  const teamCompanyIds = teamCompanyRows ? new Set(teamCompanyRows.map((r) => r.company_id)) : null;
  const pickable = teamCompanyIds ? companies.filter((c) => teamCompanyIds.has(c.id)) : companies;
  const canManage = canManageRole(me.role, agent.role as Role);
  // Keep the current role visible even if this user may not assign it.
  const roleOptions = Object.entries(ROLE_LABELS).filter(([v]) => assignableRoles(me.role).includes(v as Role) || v === agent.role);
  const assigned = new Set((assignedRes.data ?? []).map((r) => r.company_id));
  const targets = new Map((targetsRes.data ?? []).map((row) => [row.company_id, row]));
  const perf = ((perfRes.data ?? []) as { day: string; agent_id: string; company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number }[]).filter((r) => r.agent_id === id);
  const assignedCompanies = companies.filter((c) => assigned.has(c.id));
  const dayPerf = (cid: string) => perf.filter((r) => r.day === date && r.company_id === cid);
  const weekLeads = perf.reduce((s, r) => s + Number(r.leads_count), 0);
  const weekHired = perf.reduce((s, r) => s + Number(r.hired_count), 0);

  return (
    <>
      <PageHeader title={agent.full_name} subtitle={t("{0}{1}", t(ROLE_LABELS[agent.role as keyof typeof ROLE_LABELS]), agent.is_active ? "" : ` · ${t("موقوف")}`)}>
        <Link href={`/admin/leads?agent=${agent.id}`} className="btn-ghost">{t("ليدز الأجنت")}</Link>
        {agent.role === "agent" && <Link href={`/admin/scorecard?agent=${agent.id}`} className="btn-ghost">{t("التقييم الأسبوعي")}</Link>}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard emoji="📥" label={t("ليدز آخر 7 أيام")} value={weekLeads} />
        <StatCard emoji="🎉" label={t("اشتغلوا آخر 7 أيام")} value={weekHired} tone="good" />
        <StatCard emoji="🏢" label={t("الشركات المتعين عليها")} value={assigned.size} tone="brand" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold">{t("الشركات المتعين عليها")}</h2>
          <form action={saveAssignments} className="space-y-3">
            <input type="hidden" name="agent_id" value={agent.id} />
            {teamCompanyIds && (
              <p className="text-xs text-zinc-500">{t("بتظهر شركات التيم بس — شركات التيم بيحددها المدير أو الأدمن من صفحة التيم.")}</p>
            )}
            {pickable.length === 0 && <Empty>{t("التيم لسه ملوش شركات")}</Empty>}
            <div className="grid max-h-96 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {pickable.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-zinc-50">
                  <input type="checkbox" name="company_id" value={c.id} defaultChecked={assigned.has(c.id)} className="accent-brand-600" />
                  <CompanyLogo name={c.name} src={c.logo_path} size={24} />
                  {c.name}
                </label>
              ))}
            </div>
            <button className="btn-primary">{t("حفظ التعيينات")}</button>
          </form>
        </section>

        <section className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("التارجت اليومي")}</h2>
            <form className="flex items-center gap-2">
              <input type="date" name="date" defaultValue={date} className="input" />
              <button className="btn-ghost">{t("عرض")}</button>
            </form>
          </div>
          {assignedCompanies.length === 0 ? (
            <Empty>{t("عيّن شركات الأول")}</Empty>
          ) : (
            <form action={saveTargets} className="space-y-3">
              <input type="hidden" name="agent_id" value={agent.id} />
              <input type="hidden" name="date" value={date} />
              <table className="data-table">
                <thead>
                  <tr><th>{t("الشركة")}</th><th>{t("تارجت ليدز")}</th><th>{t("تارجت تعيين")}</th><th>{t("المحقق")}</th></tr>
                </thead>
                <tbody>
                  {assignedCompanies.map((c) => {
                    const target = targets.get(c.id);
                    const p = dayPerf(c.id);
                    return (
                      <tr key={c.id}>
                        <td>
                          <input type="hidden" name="company_id" value={c.id} />
                          <span className="flex items-center gap-2"><CompanyLogo name={c.name} src={c.logo_path} size={22} />{c.name}</span>
                        </td>
                        <td><input name={`leads_${c.id}`} type="number" min={0} defaultValue={target?.target_leads ?? 0} className="input w-20" /></td>
                        <td><input name={`hired_${c.id}`} type="number" min={0} defaultValue={target?.target_hired ?? 0} className="input w-20" /></td>
                        <td className="text-xs text-zinc-500 tabular-nums">
                          {p.reduce((s, r) => s + Number(r.leads_count), 0)} {t("ليد ·")} {p.reduce((s, r) => s + Number(r.hired_count), 0)} {t("اشتغل")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="apply_week" className="accent-brand-600" /> {t("طبّق نفس التارجت على الـ 7 أيام الجاية")}
              </label>
              <button className="btn-primary">{t("حفظ التارجت")}</button>
            </form>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">{t("أداء آخر 7 أيام")}</h2>
          {perf.length === 0 ? (
            <Empty>{t("مفيش نشاط")}</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {[...new Set(perf.map((r) => r.day))].sort().reverse().map((day) => {
                const rows = perf.filter((r) => r.day === day);
                const leads = rows.reduce((s, r) => s + Number(r.leads_count), 0);
                const tLeads = rows.reduce((s, r) => s + r.target_leads, 0);
                return (
                  <li key={day} className="grid grid-cols-[6rem_1fr] items-center gap-2">
                    <span className="text-zinc-500 tabular-nums">{day}</span>
                    <Progress value={leads} target={tLeads} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t("التاسكات")}</h2>
            <Link href={`/admin/tasks?agent=${agent.id}`} className="text-sm text-brand-700">{t("تاسك جديد")}</Link>
          </div>
          {(tasksRes.data ?? []).length === 0 ? (
            <Empty>{t("مفيش تاسكات")}</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(tasksRes.data ?? []).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2">
                  <span>{row.title}</span>
                  <span className="text-xs text-zinc-500">{t(PRIORITY_LABELS[row.priority as TaskPriority])} · {t(TASK_STATUS_LABELS[row.status as TaskStatus])}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage && (() => { const self = agent.id === me.id; const activeLocked = self || me.role !== "admin"; return (
          <section className="card lg:col-span-2">
            <h2 className="card-title">{t("بيانات الحساب ومكان الشغل")}</h2>
            <form action={updateUser} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="id" value={agent.id} />
              <div>
                <label className="label">{t("الاسم")}</label>
                <input name="full_name" defaultValue={agent.full_name} required className="input" />
              </div>
              <div>
                <label className="label">{t("الموبايل")}</label>
                <input name="phone" defaultValue={agent.phone ?? ""} dir="ltr" className="input" />
              </div>
              <div>
                <label className="label">{t("كلمة سر جديدة (اختياري)")}</label>
                <input name="password" type="text" minLength={8} dir="ltr" className="input" />
              </div>
              <div>
                <label className="label">{t("الصلاحية")}</label>
                <select name="role" defaultValue={agent.role} className="input" disabled={self}>
                  {roleOptions.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
                {self && <input type="hidden" name="role" value={agent.role} />}
              </div>
              <div>
                <label className="label">{t("التيم")}</label>
                <select name="team_id" defaultValue={agent.team_id ?? ""} className="input">
                  <option value="">—</option>
                  {(teamsRes.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t("مكان الشغل")}</label>
                <select name="location_id" defaultValue={agent.location_id ?? ""} className="input">
                  <option value="">{t("بدون — يفتح من أي مكان")}</option>
                  {(locationsRes.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 self-end rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
                <input type="checkbox" name="allow_anywhere" defaultChecked={agent.allow_anywhere} className="accent-brand-600" /> {t("مسموح يفتح من أي مكان")}
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                <input type="checkbox" name="is_active" defaultChecked={agent.is_active} disabled={activeLocked} className="accent-brand-600" /> {t("الحساب نشط")}
                {activeLocked && agent.is_active && <input type="hidden" name="is_active" value="on" />}
              </label>
              {me.role === "manager" && (
                <p className="text-xs text-zinc-500 sm:col-span-3">{t("إيقاف الحساب للأدمن بس — وتقدر تخلّي الموظف تيم ليدر أو أجنت.")}</p>
              )}
              <div className="sm:col-span-3"><button className="btn-primary">{t("حفظ")}</button></div>
            </form>
          </section>
        ); })()}

        {canRequest && (
          <section className="card lg:col-span-2">
            <h2 className="card-title">{agent.is_active ? t("طلب إيقاف الحساب") : t("طلب تفعيل الحساب")}</h2>
            {pendingRequest ? (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900">
                {t("فيه طلب مستني موافقة الأدمن — تابعه من «طلبات الموافقة».")} <span className="text-xs">({formatDate(pendingRequest.created_at)})</span>
              </p>
            ) : (
              <StateForm action={requestAccountChange} submitLabel={t("ابعت الطلب للأدمن")} className="grid gap-3">
                <input type="hidden" name="target_id" value={agent.id} />
                <input type="hidden" name="kind" value={agent.is_active ? "deactivate" : "activate"} />
                <label className="label" htmlFor="reason">{t("السبب")}</label>
                <textarea id="reason" name="reason" required minLength={3} maxLength={500} rows={2} className="input" placeholder={agent.is_active ? t("مثلاً: ساب الشغل، غياب متكرر…") : t("مثلاً: رجع الشغل من النهارده")} />
              </StateForm>
            )}
          </section>
        )}
      </div>
    </>
  );
}
