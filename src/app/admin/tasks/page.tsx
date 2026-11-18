import { createTask, deleteTask } from "@/app/admin/actions";
import { setTaskStatus } from "@/app/actions/notifications";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/types";

const STATUS_CLS: Record<TaskStatus, string> = {
  pending: "bg-zinc-200 text-zinc-700",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-rose-100 text-rose-700",
};

export default async function AdminTasksPage({ searchParams }: PageProps<"/admin/tasks">) {
  await requireRole(...STAFF);
  const sp = await searchParams;
  const agentFilter = typeof sp.agent === "string" ? sp.agent : "";
  const statusFilter = typeof sp.status === "string" && sp.status in TASK_STATUS_LABELS ? sp.status : "";
  const supabase = await createClient();

  let q = supabase
    .from("tasks")
    .select("id, title, description, status, priority, due_date, created_at, completed_at, agent:profiles!tasks_agent_id_fkey(id, full_name), companies(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (/^[0-9a-f-]{36}$/i.test(agentFilter)) q = q.eq("agent_id", agentFilter);
  if (statusFilter) q = q.eq("status", statusFilter);

  const [{ data: tasks }, { data: agents }, companies] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name"),
    getCompanies(true),
  ]);

  return (
    <>
      <PageHeader title="التاسكات" />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card h-fit">
          <h2 className="mb-3 font-semibold">تاسك جديد</h2>
          <StateForm action={createTask} className="space-y-3" submitLabel="إرسال" resetOnSuccess>
            <input name="title" required placeholder="المطلوب (مثلاً: كلم ليدز امبارح اللي ماردوش)" className="input" />
            <textarea name="description" rows={3} placeholder="تفاصيل" className="input" />
            <div className="grid grid-cols-2 gap-2">
              <select name="priority" defaultValue="medium" className="input">
                {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input name="due_date" type="date" className="input" aria-label="آخر ميعاد" />
            </div>
            <select name="company_id" className="input">
              <option value="">الشركة (اختياري)</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <fieldset>
              <legend className="label">لمين؟</legend>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
                {(agents ?? []).map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="agent_id" value={a.id} defaultChecked={a.id === agentFilter} className="accent-brand-600" />
                    {a.full_name}
                  </label>
                ))}
              </div>
            </fieldset>
          </StateForm>
        </section>

        <section className="card lg:col-span-2">
          <form className="mb-4 flex flex-wrap gap-2">
            <select name="agent" defaultValue={agentFilter} className="input w-auto">
              <option value="">كل الأجنتس</option>
              {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
            <select name="status" defaultValue={statusFilter} className="input w-auto">
              <option value="">كل الحالات</option>
              {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn-ghost">فلتر</button>
          </form>
          {(tasks ?? []).length === 0 ? (
            <Empty>مفيش تاسكات</Empty>
          ) : (
            <ul className="space-y-2">
              {(tasks ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-zinc-200 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.title}</p>
                    {t.description && <p className="text-sm text-zinc-600">{t.description}</p>}
                    <p className="mt-1 text-xs text-zinc-500">
                      {(t.agent as unknown as { full_name: string } | null)?.full_name}
                      {(t.companies as unknown as { name: string } | null) && ` · ${(t.companies as unknown as { name: string }).name}`}
                      {` · ${PRIORITY_LABELS[t.priority as TaskPriority]}`}
                      {t.due_date && ` · لحد ${t.due_date}`}
                      {` · ${formatDate(t.created_at)}`}
                    </p>
                  </div>
                  <span className={`badge ${STATUS_CLS[t.status as TaskStatus]}`}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</span>
                  <div className="flex gap-1">
                    {t.status !== "cancelled" && t.status !== "done" && (
                      <form action={setTaskStatus}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value="cancelled" />
                        <button className="btn-ghost px-2 py-1 text-xs">إلغاء</button>
                      </form>
                    )}
                    <form action={deleteTask}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn-danger px-2 py-1 text-xs">حذف</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
