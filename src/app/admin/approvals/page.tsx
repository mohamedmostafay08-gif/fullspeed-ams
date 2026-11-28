import Link from "next/link";
import { Coffee, Inbox, ShieldCheck } from "lucide-react";
import { decideRequest } from "@/app/actions/management";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/app-shell";
import { BreakDecision } from "@/components/breaks";
import { LEAVE_SELECT, LeavesToDecide, PERMIT_SELECT, PermitsToDecide, type Leave, type Permit } from "@/components/leaves";
import { LiveRefresh } from "@/components/live";
import { Empty, formatDate } from "@/components/ui";
import { cairoRange, cairoToday, requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Load = { team: number; peak: number; peak_day: string | null };
type BreakRow = { id: string; requested_at: string; agent: { id: string; full_name: string } | null };
type RequestRow = {
  id: string;
  kind: "deactivate" | "activate";
  reason: string;
  created_at: string;
  target: { id: string; full_name: string } | null;
  requester: { full_name: string } | null;
};

/** Everything waiting for a yes or no, in one place: breaks, leaves, hour permits and account requests. */
export default async function ApprovalsPage() {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const isAdmin = me.role === "admin";
  const today = cairoToday();
  const [start, end] = cairoRange(today, today);
  const supabase = await createClient();

  const [breaksRes, leavesRes, permitsRes, requestsRes] = await Promise.all([
    supabase.from("agent_breaks").select("id, requested_at, agent:profiles!agent_breaks_agent_id_fkey(id, full_name)")
      .eq("status", "pending").gte("requested_at", start).lt("requested_at", end).order("requested_at"),
    supabase.from("leave_requests").select(LEAVE_SELECT).eq("status", "pending").neq("user_id", me.id).order("start_date").limit(100),
    supabase.from("hour_permits").select(PERMIT_SELECT).eq("status", "pending").neq("user_id", me.id).order("day").limit(100),
    isAdmin
      ? supabase.from("admin_requests")
          .select("id, kind, reason, created_at, target:profiles!admin_requests_target_id_fkey(id, full_name), requester:profiles!admin_requests_requested_by_fkey(full_name)")
          .eq("status", "pending").order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const breaks = ((breaksRes.data ?? []) as unknown as BreakRow[]).filter((b) => b.agent?.id !== me.id);
  const leaves = (leavesRes.data ?? []) as unknown as Leave[];
  const permits = (permitsRes.data ?? []) as unknown as Permit[];
  const requests = (requestsRes.data ?? []) as unknown as RequestRow[];
  const total = breaks.length + leaves.length + permits.length + requests.length;

  // How full each requester's team already is; the nearest 10 keep the page under the Workers call limit.
  const loads = await Promise.all(
    leaves.slice(0, 10).map(async (l) => [l.id, (await supabase.rpc("team_leave_load", { p_user: l.user_id, p_from: l.start_date, p_to: l.end_date })).data as Load] as const),
  );

  return (
    <>
      <LiveRefresh channel="admin-approvals" />
      <PageHeader
        title={t("الموافقات")}
        subtitle={total ? t("{0} طلب مستني ردك", total) : t("مفيش حاجة مستنية ردك دلوقتي")}
      >
        <Link href="/admin/leaves" className="btn-ghost">{t("تقويم الإجازات")}</Link>
      </PageHeader>

      {total === 0 ? (
        <section className="card"><Empty icon={Inbox}>{t("كله متقفل 👏")}</Empty></section>
      ) : (
        <div className="space-y-6">
          {breaks.length > 0 && (
            <section className="card">
              <h2 className="card-title"><Coffee size={18} className="text-teal-500" /> {t("بريكات ({0})", breaks.length)}</h2>
              <ul className="divide-y divide-zinc-100">
                {breaks.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold">{b.agent?.full_name ?? "—"}</p>
                      <p className="text-xs text-zinc-500">{t("طلب بريك")} · {formatDate(b.requested_at)}</p>
                    </div>
                    <BreakDecision id={b.id} mode="pending" />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {leaves.length > 0 && <LeavesToDecide rows={leaves} load={Object.fromEntries(loads.filter(([, v]) => v))} />}
          {permits.length > 0 && <PermitsToDecide rows={permits} />}
          {requests.length > 0 && (
            <section className="card">
              <h2 className="card-title"><ShieldCheck size={18} className="text-amber-500" /> {t("طلبات الحسابات ({0})", requests.length)}</h2>
              <ul className="divide-y divide-zinc-100">
                {requests.map((r) => (
                  <li key={r.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div>
                      <p className="font-semibold">
                        <span className={`badge me-2 ${r.kind === "deactivate" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>
                          {t(r.kind === "deactivate" ? "إيقاف حساب" : "تفعيل حساب")}
                        </span>
                        {r.target ? <Link href={`/admin/agents/${r.target.id}`} className="hover:underline">{r.target.full_name}</Link> : "—"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">«{r.reason}»</p>
                      <p className="mt-1 text-xs text-zinc-500">{t("طلب من {0}", r.requester?.full_name ?? "—")} · {formatDate(r.created_at)}</p>
                    </div>
                    <ActionForm action={decideRequest} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="note" placeholder={t("ملاحظة (اختياري)")} className="input py-2 sm:w-56" />
                      <button name="decision" value="approve" className="btn-primary">{t("موافق")}</button>
                      <button name="decision" value="reject" className="btn-ghost text-rose-600">{t("رفض")}</button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
