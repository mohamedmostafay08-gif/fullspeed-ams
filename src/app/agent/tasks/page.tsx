import { setTaskStatus } from "@/app/actions/notifications";
import { PageHeader } from "@/components/app-shell";
import { AGENT_WORK_TABS, SubTabs } from "@/components/sub-tabs";
import { Empty, formatDate } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const NEXT: Partial<Record<TaskStatus, { status: TaskStatus; label: string }[]>> = {
  pending: [{ status: "in_progress", label: "بدأت" }, { status: "done", label: "تم ✓" }],
  in_progress: [{ status: "done", label: "تم ✓" }],
  done: [{ status: "in_progress", label: "رجّعها" }],
};

export default async function AgentTasksPage() {
  const t = await getT();
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
      <PageHeader title={t("التاسكات")} />
      <SubTabs tabs={AGENT_WORK_TABS} current="/agent/tasks" />
      {(tasks ?? []).length === 0 ? (
        <Empty>{t("مفيش تاسكات")}</Empty>
      ) : (
        <ul className="space-y-3">
          {(tasks ?? []).map((row) => (
            <li key={row.id} className={`card flex flex-wrap items-start gap-3 ${row.status === "done" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{row.title}</p>
                {row.description && <p className="mt-1 whitespace-pre-line text-sm text-zinc-600">{row.description}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  {t(TASK_STATUS_LABELS[row.status as TaskStatus])} · {t(PRIORITY_LABELS[row.priority as TaskPriority])}
                  {(row.companies as unknown as { name: string } | null) && ` · ${(row.companies as unknown as { name: string }).name}`}
                  {row.due_date && t(" · لحد {0}", row.due_date)} · {formatDate(row.created_at)}
                </p>
              </div>
              <div className="flex gap-2">
                {(NEXT[row.status as TaskStatus] ?? []).map((n) => (
                  <form key={n.status} action={setTaskStatus}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="status" value={n.status} />
                    <button className={n.status === "done" ? "btn-primary px-3 py-1 text-xs" : "btn-ghost px-3 py-1 text-xs"}>{t(n.label)}</button>
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
