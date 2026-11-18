import { setTaskStatus } from "@/app/actions/notifications";
import { PageHeader } from "@/components/app-shell";
import { Empty, formatDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/types";

const NEXT: Partial<Record<TaskStatus, { status: TaskStatus; label: string }[]>> = {
  pending: [{ status: "in_progress", label: "بدأت" }, { status: "done", label: "تم ✓" }],
  in_progress: [{ status: "done", label: "تم ✓" }],
  done: [{ status: "in_progress", label: "رجّعها" }],
};

export default async function AgentTasksPage() {
  const profile = await requireRole("agent");
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, description, status, priority, due_date, created_at, companies(name)")
    .eq("agent_id", profile.id)
    .neq("status", "cancelled")
    .order("status")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader title="التاسكات" />
      {(tasks ?? []).length === 0 ? (
        <Empty>مفيش تاسكات</Empty>
      ) : (
        <ul className="space-y-3">
          {(tasks ?? []).map((t) => (
            <li key={t.id} className={`card flex flex-wrap items-start gap-3 ${t.status === "done" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}</p>
                {t.description && <p className="mt-1 whitespace-pre-line text-sm text-zinc-600">{t.description}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  {TASK_STATUS_LABELS[t.status as TaskStatus]} · {PRIORITY_LABELS[t.priority as TaskPriority]}
                  {(t.companies as unknown as { name: string } | null) && ` · ${(t.companies as unknown as { name: string }).name}`}
                  {t.due_date && ` · لحد ${t.due_date}`} · {formatDate(t.created_at)}
                </p>
              </div>
              <div className="flex gap-2">
                {(NEXT[t.status as TaskStatus] ?? []).map((n) => (
                  <form key={n.status} action={setTaskStatus}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value={n.status} />
                    <button className={n.status === "done" ? "btn-primary px-3 py-1 text-xs" : "btn-ghost px-3 py-1 text-xs"}>{n.label}</button>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
