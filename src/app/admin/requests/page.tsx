import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { History, ShieldCheck } from "lucide-react";
import { cancelRequest, decideRequest } from "@/app/actions/management";
import { PageHeader } from "@/components/app-shell";
import { PendingInApprovals } from "@/components/pending-note";
import { Empty, formatDate } from "@/components/ui";
import { STAFF, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Row = {
  id: string;
  kind: "deactivate" | "activate";
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  target: { id: string; full_name: string } | null;
  requester: { full_name: string } | null;
};

const KIND: Record<Row["kind"], string> = { deactivate: "إيقاف حساب", activate: "تفعيل حساب" };
const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  pending: { label: "مستني الأدمن", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "اتوافق عليه", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "اترفض", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "اتلغى", cls: "bg-zinc-100 text-zinc-500" },
};

export default async function RequestsPage() {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const isAdmin = me.role === "admin";
  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_requests")
    .select("id, kind, reason, status, decision_note, created_at, decided_at, target:profiles!admin_requests_target_id_fkey(id, full_name), requester:profiles!admin_requests_requested_by_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title={t("طلبات الموافقة")}
        subtitle={isAdmin ? t("طلبات المديرين لإيقاف أو تفعيل حسابات — القرار عندك") : t("إيقاف أو تفعيل أي حساب محتاج موافقة الأدمن — اطلبه من صفحة الموظف")}
      />

      {isAdmin && <PendingInApprovals count={pending.length} label={t("{0} طلب حساب مستني قرارك", pending.length)} />}
      {!isAdmin && (
      <section className="card">
        <h2 className="card-title"><ShieldCheck size={18} className="text-amber-500" /> {t("طلبات مستنية ({0})", pending.length)}</h2>
        {pending.length === 0 ? (
          <Empty icon={ShieldCheck}>{t("مفيش طلبات مستنية")}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {pending.map((r) => (
              <li key={r.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <p className="font-semibold">
                    <span className={`badge me-2 ${r.kind === "deactivate" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>{t(KIND[r.kind])}</span>
                    {r.target ? <Link href={`/admin/agents/${r.target.id}`} className="hover:underline">{r.target.full_name}</Link> : "—"}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">«{r.reason}»</p>
                  <p className="mt-1 text-xs text-zinc-500">{t("طلب من {0}", r.requester?.full_name ?? "—")} · {formatDate(r.created_at)}</p>
                </div>
                {isAdmin ? (
                  <ActionForm action={decideRequest} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="note" placeholder={t("ملاحظة (اختياري)")} className="input py-2 sm:w-56" />
                    <button name="decision" value="approve" className="btn-primary">{t("موافق")}</button>
                    <button name="decision" value="reject" className="btn-ghost text-rose-600">{t("رفض")}</button>
                  </ActionForm>
                ) : (
                  <ActionForm action={cancelRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn-ghost text-zinc-600">{t("إلغاء الطلب")}</button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      <section className="card mt-6">
        <h2 className="card-title"><History size={18} className="text-zinc-500" /> {t("الطلبات اللي اتقفلت")}</h2>
        {history.length === 0 ? (
          <Empty>{t("لسه مفيش")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>{t("الطلب")}</th><th>{t("الموظف")}</th><th>{t("السبب")}</th><th>{t("مين طلب")}</th><th>{t("الحالة")}</th><th>{t("ملاحظة الأدمن")}</th><th>{t("إمتى")}</th></tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{t(KIND[r.kind])}</td>
                    <td className="font-semibold">{r.target?.full_name ?? "—"}</td>
                    <td className="max-w-64 text-sm text-zinc-600">{r.reason}</td>
                    <td className="text-sm">{r.requester?.full_name ?? "—"}</td>
                    <td><span className={`badge ${STATUS[r.status].cls}`}>{t(STATUS[r.status].label)}</span></td>
                    <td className="text-sm text-zinc-600">{r.decision_note ?? "—"}</td>
                    <td className="text-xs text-zinc-500">{formatDate(r.decided_at ?? r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
