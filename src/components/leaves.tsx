import { CalendarPlus, CalendarX2, Flag, History, Timer, Trash2, TriangleAlert } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { addHoliday, cancelLeave, cancelPermit, decideLeave, decidePermit, deleteHoliday, requestLeave, requestPermit } from "@/app/actions/management";
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

export const LEAVE_EMOJI: Record<Leave["kind"], string> = { annual: "🏖️", casual: "⚡", sick: "🤒", unpaid: "💸" };
export const LEAVE_KINDS: Record<Leave["kind"], string> = { annual: "اعتيادي", casual: "عارضة", sick: "مرضي", unpaid: "بدون مرتب" };
const STATUS_EMOJI: Record<Leave["status"], string> = { pending: "⏳", approved: "✅", rejected: "❌", cancelled: "🚫" };
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
      <StateForm action={requestLeave} resetOnSuccess submitLabel={t("ابعت الطلب")} className="grid gap-3 sm:grid-cols-2">
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
        <p className="text-xs text-zinc-500 sm:col-span-2">{t("الإجازة الأسبوعية مش بتتحسب من الأيام. الإجازة المرضي تقدر تسجلها بعد ما تحصل بحد أقصى أسبوع.")}</p>
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
                  <span className={`badge me-2 ${STATUS[l.status].cls}`}>{STATUS_EMOJI[l.status]} {t(STATUS[l.status].label)}</span>
                  {LEAVE_EMOJI[l.kind]} {t(LEAVE_KINDS[l.kind])} · <span className="num">{range(l)}</span> · {t("{0} يوم", l.days)}
                </p>
                <p className="text-xs text-zinc-500">
                  {l.reason ?? ""}
                  {l.decider && ` · ${t("الرد من {0}", l.decider.full_name)}`}
                  {l.decision_note && ` · «${l.decision_note}»`}
                </p>
              </div>
              {(l.status === "pending" || (l.status === "approved" && l.start_date > today)) && (
                <ActionForm action={cancelLeave}>
                  <input type="hidden" name="id" value={l.id} />
                  <button className="btn-ghost text-zinc-600">{t("إلغاء")}</button>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function LeavesToDecide({ rows, load = {} }: { rows: Leave[]; load?: Record<string, { team: number; peak: number; peak_day: string | null }> }) {
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
                <p className="font-semibold">{l.person?.full_name ?? "—"} <span className="badge ms-2 bg-sky-100 text-sky-800">{LEAVE_EMOJI[l.kind]} {t(LEAVE_KINDS[l.kind])}</span></p>
                <p className="mt-1 text-sm"><span className="num">{range(l)}</span> · {t("{0} يوم", l.days)}{l.reason ? ` · «${l.reason}»` : ""}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("اتطلبت")} {formatDate(l.created_at)}</p>
                {load[l.id] && load[l.id].team > 1 && (load[l.id].peak + 1) * 2 > load[l.id].team && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    <TriangleAlert size={14} /> {t("لو وافقت هيبقى {0} من {1} في التيم إجازة يوم {2}", load[l.id].peak + 1, load[l.id].team, load[l.id].peak_day ?? "")}
                  </p>
                )}
              </div>
              <ActionForm action={decideLeave} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={l.id} />
                <input name="note" placeholder={t("ملاحظة (اختياري)")} className="input py-2 sm:w-48" />
                <button name="decision" value="approve" className="btn-primary">{t("موافق")}</button>
                <button name="decision" value="reject" className="btn-ghost text-rose-600">{t("رفض")}</button>
              </ActionForm>
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
                  <td>{LEAVE_EMOJI[l.kind]} {t(LEAVE_KINDS[l.kind])}</td>
                  <td className="num">{l.days}</td>
                  <td className="num text-sm">{range(l)}</td>
                  <td><span className={`badge ${STATUS[l.status].cls}`}>{STATUS_EMOJI[l.status]} {t(STATUS[l.status].label)}</span></td>
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

// ───────── Hourly permits ─────────
export type Permit = {
  id: string;
  user_id: string;
  day: string;
  kind: "late_arrival" | "early_leave";
  at_time: string;
  reason: string | null;
  status: Leave["status"];
  decision_note: string | null;
  created_at: string;
  person?: { full_name: string } | null;
  decider?: { full_name: string } | null;
};
export const PERMIT_SELECT =
  "id, user_id, day, kind, at_time, reason, status, decision_note, created_at, person:profiles!hour_permits_user_id_fkey(full_name), decider:profiles!hour_permits_decided_by_fkey(full_name)";
const permitLabel = (p: Permit) => (p.kind === "late_arrival" ? "إذن تأخير لحد {0}" : "إذن خروج الساعة {0}");

export async function PermitRequestForm() {
  const t = await getT();
  const today = cairoToday();
  return (
    <section className="card">
      <h2 className="card-title"><Timer size={18} className="text-brand-600" /> {t("اطلب إذن بالساعة")}</h2>
      <StateForm action={requestPermit} resetOnSuccess submitLabel={t("ابعت الطلب")} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="permit_kind">{t("نوع الإذن")}</label>
          <select id="permit_kind" name="kind" className="input" defaultValue="late_arrival">
            <option value="late_arrival">{t("هتأخر في الوصول")}</option>
            <option value="early_leave">{t("همشي بدري")}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="permit_day">{t("اليوم")}</label>
          <input id="permit_day" name="day" type="date" required min={today} defaultValue={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="permit_time">{t("الساعة")}</label>
          <input id="permit_time" name="at_time" type="time" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="permit_reason">{t("السبب (اختياري)")}</label>
          <input id="permit_reason" name="reason" maxLength={300} className="input" />
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-2">{t("لو الإذن اتوافق عليه، التأخير لحد الساعة اللي كتبتها مش بيتحسب عليك.")}</p>
      </StateForm>
    </section>
  );
}

export async function MyPermits({ rows }: { rows: Permit[] }) {
  const t = await getT();
  const today = cairoToday();
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2 className="card-title"><Timer size={18} className="text-zinc-500" /> {t("أذوناتي")}</h2>
      <ul className="divide-y divide-zinc-100">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-semibold">
                <span className={`badge me-2 ${STATUS[p.status].cls}`}>{STATUS_EMOJI[p.status]} {t(STATUS[p.status].label)}</span>
                {t(permitLabel(p), p.at_time.slice(0, 5))} · <span className="num">{p.day}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {p.reason ?? ""}
                {p.decider && ` · ${t("الرد من {0}", p.decider.full_name)}`}
                {p.decision_note && ` · «${p.decision_note}»`}
              </p>
            </div>
            {(p.status === "pending" || p.status === "approved") && p.day >= today && (
              <ActionForm action={cancelPermit}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn-ghost text-zinc-600">{t("إلغاء")}</button>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function PermitsToDecide({ rows }: { rows: Permit[] }) {
  const t = await getT();
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2 className="card-title"><Timer size={18} className="text-amber-500" /> {t("أذونات مستنية ردك ({0})", rows.length)}</h2>
      <ul className="divide-y divide-zinc-100">
        {rows.map((p) => (
          <li key={p.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-semibold">{p.person?.full_name ?? "—"}</p>
              <p className="mt-1 text-sm">{t(permitLabel(p), p.at_time.slice(0, 5))} · <span className="num">{p.day}</span>{p.reason ? ` · «${p.reason}»` : ""}</p>
            </div>
            <ActionForm action={decidePermit} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={p.id} />
              <input name="note" placeholder={t("ملاحظة (اختياري)")} className="input py-2 sm:w-48" />
              <button name="decision" value="approve" className="btn-primary">{t("موافق")}</button>
              <button name="decision" value="reject" className="btn-ghost text-rose-600">{t("رفض")}</button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────── Official holidays ─────────
export type Holiday = { day: string; name: string };

export async function Holidays({ rows, canEdit }: { rows: Holiday[]; canEdit: boolean }) {
  const t = await getT();
  return (
    <section className="card">
      <h2 className="card-title"><Flag size={18} className="text-emerald-600" /> {t("الإجازات الرسمية")}</h2>
      <p className="mb-3 text-xs text-zinc-500">{t("الأيام دي مش بتتحسب غياب ولا تأخير على حد، ومش بتتخصم من الإجازات.")}</p>
      {canEdit && (
        <StateForm action={addHoliday} resetOnSuccess submitLabel={t("ضيف")} className="mb-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="holiday_name">{t("اسم الإجازة")}</label>
            <input id="holiday_name" name="name" required maxLength={80} placeholder={t("مثلاً: عيد الفطر")} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="holiday_day">{t("من يوم")}</label>
            <input id="holiday_day" name="day" type="date" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="holiday_to">{t("لحد يوم (لو أكتر من يوم)")}</label>
            <input id="holiday_to" name="to" type="date" className="input" />
          </div>
        </StateForm>
      )}
      {rows.length === 0 ? (
        <Empty>{t("مفيش إجازات رسمية جاية")}</Empty>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((h) => (
            <li key={h.day} className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900">
              <span className="num font-semibold">{h.day}</span> {h.name}
              {canEdit && (
                <form action={deleteHoliday}>
                  <input type="hidden" name="day" value={h.day} />
                  <button aria-label={t("امسح")} className="text-emerald-700 hover:text-rose-600"><Trash2 size={14} /></button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
