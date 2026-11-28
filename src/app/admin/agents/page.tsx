import { FilterBar } from "@/components/filter-bar";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Building2 } from "lucide-react";
import { createTeam, createUser, updateTeam } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { bulkUsers } from "@/app/actions/users";
import { CredentialsHelper } from "@/components/credentials-helper";
import { SelectAllBox } from "@/components/select-all-box";
import { requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_EMOJI, ROLE_LABELS, assignableRoles, type Role } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export default async function AgentsPage({ searchParams }: PageProps<"/admin/agents">) {
  const t = await getT();
  const profile = await requireRole(...STAFF);
  const isAdmin = profile.role === "admin" || profile.role === "manager";
  // Team leaders add agents straight into their own team.
  const canAdd = isAdmin || (profile.role === "team_leader" && !!profile.team_id);
  // Suspending, signing out and the bulk bar are the admin's.
  const isOwner = profile.role === "admin";
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const UUID = /^[0-9a-f-]{36}$/i;
  const fQ = str("q").trim().slice(0, 60);
  const fRole = Object.hasOwn(ROLE_LABELS, str("role")) ? str("role") : "";
  const fTeam = UUID.test(str("team")) || str("team") === "none" ? str("team") : "";
  const fCompany = UUID.test(str("company")) || str("company") === "none" ? str("company") : "";
  const fLoc = UUID.test(str("loc")) ? str("loc") : "";
  const fStatus = ["active", "inactive"].includes(str("status")) ? str("status") : "";
  const anyF = !!(fQ || fRole || fTeam || fCompany || fLoc || fStatus);
  const supabase = await createClient();
  const [{ data: people }, { data: teams }, { data: assignments }, { data: locations }, { data: companies }, { data: overview }, { data: myTeamCompanies }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, team_id, is_active, location_id, allow_anywhere").order("role").order("full_name"),
    supabase.from("teams").select("id, name, leader_id").order("name"),
    supabase.from("agent_companies").select("agent_id, company_id"),
    supabase.from("work_locations").select("id, name").order("name"),
    supabase.from("companies").select("id, name").order("name"),
    // Last seen / devices / open leads (migration 0056); the page still works without it.
    isAdmin ? supabase.rpc("user_overview") : Promise.resolve({ data: null }),
    profile.role === "team_leader" && profile.team_id
      ? supabase.from("team_companies").select("company_id").eq("team_id", profile.team_id)
      : Promise.resolve({ data: null }),
  ]);
  const seen = new Map(((overview ?? []) as { user_id: string; last_seen: string | null; sessions: number; open_leads: number }[]).map((o) => [o.user_id, o]));
  const hasOverview = seen.size > 0;
  // A team leader can only hand out their team's companies.
  const teamCompanySet = myTeamCompanies ? new Set(myTeamCompanies.map((r) => r.company_id)) : null;
  const formCompanies = (companies ?? []).filter((c) => !teamCompanySet || teamCompanySet.has(c.id));
  const activeAgents = (people ?? []).filter((p) => p.role === "agent" && p.is_active);
  const locationName = new Map((locations ?? []).map((l) => [l.id, l.name]));
  const teamName = new Map((teams ?? []).map((row) => [row.id, row.name]));
  const companyCount = new Map<string, number>();
  for (const a of assignments ?? []) companyCount.set(a.agent_id, (companyCount.get(a.agent_id) ?? 0) + 1);
  const leaders = (people ?? []).filter((p) => p.role !== "agent");
  const companiesOf = new Map<string, Set<string>>();
  for (const a of assignments ?? []) {
    if (!companiesOf.has(a.agent_id)) companiesOf.set(a.agent_id, new Set());
    companiesOf.get(a.agent_id)!.add(a.company_id);
  }
  const ql = fQ.toLowerCase();
  const list = (people ?? []).filter((p) =>
    (!fQ || p.full_name.toLowerCase().includes(ql) || (p.phone ?? "").includes(fQ)) &&
    (!fRole || p.role === fRole) &&
    (!fTeam || (fTeam === "none" ? !p.team_id : p.team_id === fTeam)) &&
    (!fCompany || (fCompany === "none" ? !companiesOf.get(p.id)?.size : companiesOf.get(p.id)?.has(fCompany))) &&
    (!fLoc || p.location_id === fLoc) &&
    (!fStatus || (fStatus === "active") === p.is_active));

  return (
    <>
      <PageHeader title={t("الفريق")} subtitle={t("{0} أجنت نشط", (people ?? []).filter((p) => p.role === "agent" && p.is_active).length)}>
        <Link href="/admin/agents/assign" className="btn-primary"><Building2 size={16} /> {t("توزيع الشركات على الأجنتس")}</Link>
      </PageHeader>

      <FilterBar clearHref={"/admin/agents"} active={Boolean(anyF)}>
        <input name="q" defaultValue={fQ} placeholder={t("الاسم أو الموبايل")} className="input" aria-label={t("بحث")} />
        <select name="role" defaultValue={fRole} className="input" aria-label={t("الصلاحية")}>
          <option value="">{t("كل الصلاحيات")}</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <select name="team" defaultValue={fTeam} className="input" aria-label={t("التيم")}>
          <option value="">{t("كل التيمات")}</option>
          <option value="none">{t("من غير تيم")}</option>
          {(teams ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <select name="company" defaultValue={fCompany} className="input" aria-label={t("الشركة")}>
          <option value="">{t("كل الشركات")}</option>
          <option value="none">{t("من غير شركات")}</option>
          {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="loc" defaultValue={fLoc} className="input" aria-label={t("المكان")}>
          <option value="">{t("كل الأماكن")}</option>
          {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="status" defaultValue={fStatus} className="input" aria-label={t("الحالة")}>
          <option value="">{t("نشط وموقوف")}</option>
          <option value="active">{t("نشط")}</option>
          <option value="inactive">{t("موقوف")}</option>
        </select>
      </FilterBar>
      {anyF && <p className="mb-2 text-sm text-zinc-500">{t("{0} نتيجة", list.length)}</p>}

      {isOwner && (
        <ActionForm id="bulk-users" action={bulkUsers} className="card mb-4 flex flex-wrap items-end gap-2">
          <p className="w-full text-sm font-semibold">☑️ {t("علّم على الموظفين من الجدول، واختار تعمل فيهم إيه مرة واحدة")}</p>
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="bulk-op">{t("الأكشن")}</label>
            <select id="bulk-op" name="op" required className="input" defaultValue="">
              <option value="" disabled>{t("اختار…")}</option>
              <option value="suspend">⏸️ {t("إيقاف الحساب")}</option>
              <option value="activate">🟢 {t("تفعيل الحساب")}</option>
              <option value="signout">🚪 {t("طلّعهم من كل الأجهزة")}</option>
              <option value="add_company">🏢 {t("ضيف شركة")}</option>
              <option value="remove_company">➖ {t("شيل شركة")}</option>
              <option value="team">👥 {t("انقلهم لتيم")}</option>
            </select>
          </div>
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="bulk-company">{t("الشركة (لإضافة/شيل شركة)")}</label>
            <select id="bulk-company" name="company_id" className="input" defaultValue="">
              <option value="">—</option>
              {(companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="bulk-team">{t("التيم (للنقل)")}</label>
            <select id="bulk-team" name="team_id" className="input" defaultValue="">
              <option value="">—</option>
              <option value="none">{t("من غير تيم")}</option>
              {(teams ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </div>
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="bulk-transfer">{t("ليدزهم المفتوحة (عند الإيقاف)")}</label>
            <select id="bulk-transfer" name="transfer_to" className="input" defaultValue="">
              <option value="">{t("تفضل زي ما هي")}</option>
              <option value="pool">{t("ترجع للتوزيع")}</option>
              {activeAgents.map((a) => <option key={a.id} value={a.id}>{t("تتنقل لـ {0}", a.full_name)}</option>)}
            </select>
          </div>
          <button className="btn-primary">{t("نفّذ")}</button>
        </ActionForm>
      )}

      <section className="card md:overflow-x-auto">
        {list.length === 0 ? (
          <Empty>{t("مفيش حد لسه")}</Empty>
        ) : (
          <table className="data-table hidden md:table">
            <thead>
              <tr>{isOwner && <th className="w-8"><SelectAllBox form="bulk-users" /></th>}<th>{t("الاسم")}</th><th>{t("الصلاحية")}</th><th>{t("التيم")}</th><th>{t("المكان")}</th><th>{t("الشركات")}</th><th>{t("الموبايل")}</th>{hasOverview && <th>{t("آخر ظهور")}</th>}<th>{t("الحالة")}</th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                  {isOwner && <td>{p.id !== profile.id && <input type="checkbox" name="user_id" value={p.id} form="bulk-users" aria-label={p.full_name} className="accent-brand-600" />}</td>}
                  <td><Link href={`/admin/agents/${p.id}`} className="font-medium hover:text-brand-700">{p.full_name}</Link></td>
                  <td>{ROLE_EMOJI[p.role]} {t(ROLE_LABELS[p.role as Role])}</td>
                  <td className="text-zinc-500">{p.team_id ? teamName.get(p.team_id) : "—"}</td>
                  <td className="text-zinc-500">
                    {p.location_id ? locationName.get(p.location_id) : "—"}
                    {p.allow_anywhere && <span className="badge ms-1 bg-amber-100 text-amber-800">{t("أي مكان")}</span>}
                  </td>
                  <td className="tabular-nums">{companyCount.get(p.id) ?? 0}</td>
                  <td className="text-zinc-500"><span dir="ltr">{p.phone ?? "—"}</span></td>
                  {hasOverview && (() => { const o = seen.get(p.id); return (
                    <td className="text-xs text-zinc-500">
                      {o?.last_seen ? formatDate(o.last_seen) : "—"}
                      {o && o.sessions > 0 && <span className="badge ms-1 bg-emerald-100 text-emerald-800">{t("{0} جهاز", o.sessions)}</span>}
                    </td>
                  ); })()}
                  <td>{p.is_active ? <span className="badge bg-emerald-100 text-emerald-800">🟢 {t("نشط")}</span> : <span className="badge bg-zinc-200">⏸️ {t("موقوف")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Phone: one card per person */}
        <ul className="-my-1 divide-y divide-zinc-100 md:hidden">
          {list.map((p) => (
            <li key={p.id} className={`flex items-center gap-2 ${p.is_active ? "" : "opacity-50"}`}>
              {isOwner && p.id !== profile.id && <input type="checkbox" name="user_id" value={p.id} form="bulk-users" aria-label={p.full_name} className="accent-brand-600" />}
              <Link href={`/admin/agents/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 active:bg-zinc-50">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white">
                  {p.full_name.split(/\s+/).slice(0, 2).map((x: string) => x[0]).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.full_name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {t(ROLE_LABELS[p.role as Role])}
                    {p.team_id ? ` · ${teamName.get(p.team_id)}` : ""}
                    {p.location_id ? ` · ${locationName.get(p.location_id)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.is_active ? <span className="badge bg-emerald-100 text-emerald-800">🟢 {t("نشط")}</span> : <span className="badge bg-zinc-200">⏸️ {t("موقوف")}</span>}
                  <span className="text-[11px] text-zinc-400">{t("{0} شركة", companyCount.get(p.id) ?? 0)}</span>
                  {seen.get(p.id)?.last_seen && <span className="text-[11px] text-zinc-400">{t("آخر ظهور")} {formatDate(seen.get(p.id)!.last_seen)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {canAdd && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card">
            <h2 className="mb-3 font-semibold">{isAdmin ? t("إضافة موظف") : t("إضافة أجنت لتيمك")}</h2>
            <StateForm action={createUser} className="grid gap-3 sm:grid-cols-2" submitLabel={t("إنشاء الحساب")} resetOnSuccess>
              <div>
                <label className="label" htmlFor="full_name">{t("الاسم")}</label>
                <input id="full_name" name="full_name" required className="input" />
              </div>
              <div>
                <label className="label" htmlFor="phone">{t("الموبايل")}</label>
                <input id="phone" name="phone" dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="email">{t("الإيميل (للدخول)")}</label>
                <input id="email" name="email" type="email" required dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="password">{t("كلمة السر")}</label>
                <input id="password" name="password" type="text" required minLength={8} dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="role">{t("الصلاحية")}</label>
                <select id="role" name="role" defaultValue="agent" className="input">
                  {Object.entries(ROLE_LABELS)
                    .filter(([v]) => assignableRoles(profile.role).includes(v as Role))
                    .map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="location_id">{t("مكان الشغل")}</label>
                <select id="location_id" name="location_id" className="input">
                  <option value="">{t("بدون")}</option>
                  {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
                <input type="checkbox" name="allow_anywhere" className="accent-brand-600" /> {t("يفتح من أي مكان")}
              </label>
              <div>
                <label className="label" htmlFor="team_id">{t("التيم")}</label>
                {isAdmin ? (
                  <select id="team_id" name="team_id" className="input">
                    <option value="">—</option>
                    {(teams ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                ) : (
                  <p className="input bg-zinc-50">{teamName.get(profile.team_id!) ?? "—"}</p>
                )}
              </div>
              {formCompanies.length > 0 && (
                <fieldset className="sm:col-span-full">
                  <legend className="label">🏢 {t("الشركات اللي هيشتغل عليها (للأجنت)")}</legend>
                  <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-zinc-200 p-2 sm:grid-cols-2">
                    {formCompanies.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-zinc-50">
                        <input type="checkbox" name="company_id" value={c.id} className="accent-brand-600" /> {c.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{t("تقدر تعدّلها بعدين من صفحة الأجنت أو من «توزيع الشركات».")}</p>
                </fieldset>
              )}
              <CredentialsHelper />
              <p className="text-xs text-zinc-500 sm:col-span-full">{t("ابعت الواتساب قبل «إنشاء الحساب» — الفورم بيتمسح بعد الحفظ.")}</p>
            </StateForm>
          </section>

          {isAdmin && (
          <section className="card space-y-4">
            <h2 className="font-semibold">{t("التيمز")}</h2>
            {(teams ?? []).map((row) => (
              <ActionForm key={row.id} action={updateTeam} className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 p-3">
                <input type="hidden" name="id" value={row.id} />
                <div className="min-w-32 flex-1">
                  <label className="label">{t("اسم التيم")}</label>
                  <input name="name" defaultValue={row.name} className="input" />
                </div>
                <div className="min-w-32 flex-1">
                  <label className="label">{t("التيم ليدر")}</label>
                  <select name="leader_id" defaultValue={row.leader_id ?? ""} className="input">
                    <option value="">—</option>
                    {leaders.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                  </select>
                </div>
                <button className="btn-ghost">{t("حفظ")}</button>
              </ActionForm>
            ))}
            <StateForm action={createTeam} className="flex flex-wrap items-end gap-2" submitLabel={t("تيم جديد")} resetOnSuccess>
              <div className="min-w-32 flex-1">
                <label className="label" htmlFor="team_name">{t("اسم التيم الجديد")}</label>
                <input id="team_name" name="name" required className="input" />
              </div>
            </StateForm>
            <p className="text-xs text-zinc-500">{t("شركات كل تيم وأرقامه من صفحة «التيمات».")}</p>
          </section>
          )}
        </div>
      )}
    </>
  );
}
