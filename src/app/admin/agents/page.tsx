import Link from "next/link";
import { createTeam, createUser, updateTeam } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, assignableRoles, type Role } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export default async function AgentsPage() {
  const t = await getT();
  const profile = await requireRole(...STAFF);
  const isAdmin = profile.role === "admin" || profile.role === "manager";
  const supabase = await createClient();
  const [{ data: people }, { data: teams }, { data: assignments }, { data: locations }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, team_id, is_active, location_id, allow_anywhere").order("role").order("full_name"),
    supabase.from("teams").select("id, name, leader_id").order("name"),
    supabase.from("agent_companies").select("agent_id"),
    supabase.from("work_locations").select("id, name").order("name"),
  ]);
  const locationName = new Map((locations ?? []).map((l) => [l.id, l.name]));
  const teamName = new Map((teams ?? []).map((row) => [row.id, row.name]));
  const companyCount = new Map<string, number>();
  for (const a of assignments ?? []) companyCount.set(a.agent_id, (companyCount.get(a.agent_id) ?? 0) + 1);
  const leaders = (people ?? []).filter((p) => p.role !== "agent");

  return (
    <>
      <PageHeader title={t("الفريق")} subtitle={t("{0} أجنت نشط", (people ?? []).filter((p) => p.role === "agent" && p.is_active).length)} />

      <section className="card md:overflow-x-auto">
        {(people ?? []).length === 0 ? (
          <Empty>{t("مفيش حد لسه")}</Empty>
        ) : (
          <table className="data-table hidden md:table">
            <thead>
              <tr><th>{t("الاسم")}</th><th>{t("الصلاحية")}</th><th>{t("التيم")}</th><th>{t("المكان")}</th><th>{t("الشركات")}</th><th>{t("الموبايل")}</th><th>{t("الحالة")}</th></tr>
            </thead>
            <tbody>
              {(people ?? []).map((p) => (
                <tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                  <td><Link href={`/admin/agents/${p.id}`} className="font-medium hover:text-brand-700">{p.full_name}</Link></td>
                  <td>{t(ROLE_LABELS[p.role as Role])}</td>
                  <td className="text-zinc-500">{p.team_id ? teamName.get(p.team_id) : "—"}</td>
                  <td className="text-zinc-500">
                    {p.location_id ? locationName.get(p.location_id) : "—"}
                    {p.allow_anywhere && <span className="badge ms-1 bg-amber-100 text-amber-800">{t("أي مكان")}</span>}
                  </td>
                  <td className="tabular-nums">{companyCount.get(p.id) ?? 0}</td>
                  <td className="text-zinc-500"><span dir="ltr">{p.phone ?? "—"}</span></td>
                  <td>{p.is_active ? <span className="badge bg-emerald-100 text-emerald-800">{t("نشط")}</span> : <span className="badge bg-zinc-200">{t("موقوف")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Phone: one card per person */}
        <ul className="-my-1 divide-y divide-zinc-100 md:hidden">
          {(people ?? []).map((p) => (
            <li key={p.id} className={p.is_active ? "" : "opacity-50"}>
              <Link href={`/admin/agents/${p.id}`} className="flex items-center gap-3 py-3 active:bg-zinc-50">
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
                  {p.is_active ? <span className="badge bg-emerald-100 text-emerald-800">{t("نشط")}</span> : <span className="badge bg-zinc-200">{t("موقوف")}</span>}
                  <span className="text-[11px] text-zinc-400">{t("{0} شركة", companyCount.get(p.id) ?? 0)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card">
            <h2 className="mb-3 font-semibold">{t("إضافة موظف")}</h2>
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
                <select id="team_id" name="team_id" className="input">
                  <option value="">—</option>
                  {(teams ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </div>
            </StateForm>
          </section>

          <section className="card space-y-4">
            <h2 className="font-semibold">{t("التيمز")}</h2>
            {(teams ?? []).map((row) => (
              <form key={row.id} action={updateTeam} className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 p-3">
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
              </form>
            ))}
            <StateForm action={createTeam} className="flex flex-wrap items-end gap-2" submitLabel={t("تيم جديد")} resetOnSuccess>
              <div className="min-w-32 flex-1">
                <label className="label" htmlFor="team_name">{t("اسم التيم الجديد")}</label>
                <input id="team_name" name="name" required className="input" />
              </div>
            </StateForm>
          </section>
        </div>
      )}
    </>
  );
}
