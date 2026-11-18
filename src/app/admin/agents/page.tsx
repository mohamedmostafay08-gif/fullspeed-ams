import Link from "next/link";
import { createTeam, createUser, updateTeam } from "@/app/admin/actions";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/types";

export default async function AgentsPage() {
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
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const companyCount = new Map<string, number>();
  for (const a of assignments ?? []) companyCount.set(a.agent_id, (companyCount.get(a.agent_id) ?? 0) + 1);
  const leaders = (people ?? []).filter((p) => p.role !== "agent");

  return (
    <>
      <PageHeader title="الفريق" subtitle={`${(people ?? []).filter((p) => p.role === "agent" && p.is_active).length} أجنت نشط`} />

      <section className="card overflow-x-auto">
        {(people ?? []).length === 0 ? (
          <Empty>مفيش حد لسه</Empty>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>الاسم</th><th>الصلاحية</th><th>التيم</th><th>المكان</th><th>الشركات</th><th>الموبايل</th><th>الحالة</th></tr>
            </thead>
            <tbody>
              {(people ?? []).map((p) => (
                <tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                  <td><Link href={`/admin/agents/${p.id}`} className="font-medium hover:text-brand-700">{p.full_name}</Link></td>
                  <td>{ROLE_LABELS[p.role as Role]}</td>
                  <td className="text-zinc-500">{p.team_id ? teamName.get(p.team_id) : "—"}</td>
                  <td className="text-zinc-500">
                    {p.location_id ? locationName.get(p.location_id) : "—"}
                    {p.allow_anywhere && <span className="badge mr-1 bg-amber-100 text-amber-800">أي مكان</span>}
                  </td>
                  <td className="tabular-nums">{companyCount.get(p.id) ?? 0}</td>
                  <td dir="ltr" className="text-right text-zinc-500">{p.phone ?? "—"}</td>
                  <td>{p.is_active ? <span className="badge bg-emerald-100 text-emerald-800">نشط</span> : <span className="badge bg-zinc-200">موقوف</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isAdmin && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card">
            <h2 className="mb-3 font-semibold">إضافة موظف</h2>
            <StateForm action={createUser} className="grid gap-3 sm:grid-cols-2" submitLabel="إنشاء الحساب" resetOnSuccess>
              <div>
                <label className="label" htmlFor="full_name">الاسم</label>
                <input id="full_name" name="full_name" required className="input" />
              </div>
              <div>
                <label className="label" htmlFor="phone">الموبايل</label>
                <input id="phone" name="phone" dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="email">الإيميل (للدخول)</label>
                <input id="email" name="email" type="email" required dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="password">كلمة السر</label>
                <input id="password" name="password" type="text" required minLength={8} dir="ltr" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="role">الصلاحية</label>
                <select id="role" name="role" defaultValue="agent" className="input">
                  {Object.entries(ROLE_LABELS)
                    .filter(([v]) => profile.role === "admin" || v !== "admin")
                    .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="location_id">مكان الشغل</label>
                <select id="location_id" name="location_id" className="input">
                  <option value="">بدون</option>
                  {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
                <input type="checkbox" name="allow_anywhere" className="accent-brand-600" /> يفتح من أي مكان
              </label>
              <div>
                <label className="label" htmlFor="team_id">التيم</label>
                <select id="team_id" name="team_id" className="input">
                  <option value="">—</option>
                  {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </StateForm>
          </section>

          <section className="card space-y-4">
            <h2 className="font-semibold">التيمز</h2>
            {(teams ?? []).map((t) => (
              <form key={t.id} action={updateTeam} className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 p-3">
                <input type="hidden" name="id" value={t.id} />
                <div className="min-w-32 flex-1">
                  <label className="label">اسم التيم</label>
                  <input name="name" defaultValue={t.name} className="input" />
                </div>
                <div className="min-w-32 flex-1">
                  <label className="label">التيم ليدر</label>
                  <select name="leader_id" defaultValue={t.leader_id ?? ""} className="input">
                    <option value="">—</option>
                    {leaders.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                  </select>
                </div>
                <button className="btn-ghost">حفظ</button>
              </form>
            ))}
            <StateForm action={createTeam} className="flex flex-wrap items-end gap-2" submitLabel="تيم جديد" resetOnSuccess>
              <div className="min-w-32 flex-1">
                <label className="label" htmlFor="team_name">اسم التيم الجديد</label>
                <input id="team_name" name="name" required className="input" />
              </div>
            </StateForm>
          </section>
        </div>
      )}
    </>
  );
}
