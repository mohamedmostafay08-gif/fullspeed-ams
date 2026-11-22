import { CalendarPlus, CalendarX2, History } from "lucide-react";
import { cancelLeave, decideLeave, requestLeave } from "@/app/actions/management";
import { StateForm } from "@/components/state-form";
import { Empty, formatDate } from "@/components/ui";
import { cairoToday } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export type Leave = {
  id: string;
  user_id: string;
  kind: "annual" | "casual" | "sick" | "unpaid";
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision_note: string | null;
  created_at: string;
  person?: { full_name: string } | null;
  decider?: { full_name: string } | null;
};

export const LEAVE_SELECT =
  "id, user_id, kind, start_date, end_date, days, reason, status, decision_note, created_at, person:profiles!leave_requests_user_id_fkey(full_name), decider:profiles!leave_requests_decided_by_fkey(full_name)";

export const LEAVE_KINDS: Record<Leave["kind"], string> = { annual: "اعتيادي", casual: "عارضة", sick: "مرضي", unpaid: "بدون مرتب" };
const STATUS: Record<Leave["status"], { label: string; cls: string }> = {
  pending: { label: "مستني الرد", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "اتوافق عليها", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "اترفضت", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "اتلغت", cls: "bg-zinc-100 text-zinc-500" },
};

const range = (l: Leave) => (l.end_date > l.start_date ? `${l.start_date} → ${l.end_date}` : l.start_date);

export async function LeaveRequestForm() {
  const t = await getT();
  const today = cairoToday();
  return (
    <section className="card">
      <h2 className="card-title"><CalendarPlus size={18} className="text-brand-600" /> {t("اطلب إجازة")}</h2>
      <StateForm action={requestLeave} resetOnSuccess submitLabel={t("ابعت الطلب")} className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="kind">{t("نوع الإجازة")}</label>
          <select id="kind" name="kind" className="input" defaultValue="annual">
            {Object.entries(LEAVE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="start_date">{t("من يوم")}</label>
          <input id="start_date" name="start_date" type="date" required min={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="end_date">{t("لحد يوم")}</label>
          <input id="end_date" name="end_date" type="date" min={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="reason">{t("السبب (اختياري)")}</label>
          <input id="reason" name="reason" maxLength={300} className="input" />
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-4">{t("الإجازة الأسبوعية مش بتتحسب من الأيام. الإجازة المرضي تقدر تسجلها بعد ما تحصل بحد أقصى أسبوع.")}</p>
      </StateForm>
    </section>
  );
}

export async function MyLeaves({ rows }: { rows: Leave[] }) {
  const t = await getT();
  const today = cairoToday();
  return (
    <section className="card">
      <h2 className="card-title"><History size={18} className="text-zinc-500" /> {t("طلباتي")}</h2>
      {rows.length === 0 ? (
        <Empty icon={CalendarX2}>{t("لسه مطلبتش إجازات")}</Empty>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">
                  <span className={`badge me-2 ${STATUS[l.status].cls}`}>{t(STATUS[l.status].label)}</span>
                  {t(LEAVE_KINDS[l.kind])} · <span className="num">{range(l)}</span> · {t("{0} يوم", l.days)}
                </p>
                <p className="text-xs text-zinc-500">
                  {l.reason ?? ""}
                  {l.decider && ` · ${t("الرد من {0}", l.decider.full_name)}`}
                  {l.decision_note && ` · «${l.decision_note}»`}
                </p>
              </div>
              {(l.status === "pending" || (l.status === "approved" && l.start_date > today)) && (
                <form action={cancelLeave}>
                  <input type="hidden" name="id" value={l.id} />
                  <button className="btn-ghost text-zinc-600">{t("إلغاء")}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function LeavesToDecide({ rows }: { rows: Leave[] }) {
  const t = await getT();
  return (
    <section className="card">
      <h2 className="card-title"><CalendarPlus size={18} className="text-amber-500" /> {t("طلبات مستنية ردك ({0})", rows.length)}</h2>
      {rows.length === 0 ? (
        <Empty>{t("مفيش طلبات إجازة مستنية")}</Empty>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((l) => (
            <li key={l.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="font-semibold">{l.person?.full_name ?? "—"} <span className="badge ms-2 bg-sky-100 text-sky-800">{t(LEAVE_KINDS[l.kind])}</span></p>
                <p className="mt-1 text-sm"><span className="num">{range(l)}</span> · {t("{0} يوم", l.days)}{l.reason ? ` · «${l.reason}»` : ""}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("اتطلبت")} {formatDate(l.created_at)}</p>
              </div>
              <form action={decideLeave} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={l.id} />
                <input name="note" placeholder={t("ملاحظة (اختياري)")} className="input py-2 sm:w-48" />
                <button name="decision" value="approve" className="btn-primary">{t("موافق")}</button>
                <button name="decision" value="reject" className="btn-ghost text-rose-600">{t("رفض")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function LeavesTable({ rows, title }: { rows: Leave[]; title: string }) {
  const t = await getT();
  return (
    <section className="card">
      <h2 className="card-title"><History size={18} className="text-zinc-500" /> {title}</h2>
      {rows.length === 0 ? (
        <Empty>{t("لسه مفيش")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t("الموظف")}</th><th>{t("النوع")}</th><th>{t("الأيام")}</th><th>{t("الفترة")}</th><th>{t("الحالة")}</th><th>{t("الرد من")}</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="font-semibold">{l.person?.full_name ?? "—"}</td>
                  <td>{t(LEAVE_KINDS[l.kind])}</td>
                  <td className="num">{l.days}</td>
                  <td className="num text-sm">{range(l)}</td>
                  <td><span className={`badge ${STATUS[l.status].cls}`}>{t(STATUS[l.status].label)}</span></td>
                  <td className="text-sm text-zinc-600">{l.decider?.full_name ?? "—"}{l.decision_note ? ` · «${l.decision_note}»` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
