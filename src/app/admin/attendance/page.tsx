import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, Settings2 } from "lucide-react";
import { saveWorkSettings } from "@/app/actions/management";
import { PageHeader } from "@/components/app-shell";
import { ATTENDANCE_TABS, SubTabs } from "@/components/sub-tabs";
import { StateForm } from "@/components/state-form";
import { Empty, StatCard } from "@/components/ui";
import { MANAGERS, STAFF, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Settings = { shift_start: string; grace_minutes: number; off_days: number[] };
type MonthRow = {
  user_id: string; full_name: string; role: string; present: number; late_days: number;
  late_minutes: number; absent: number; avg_hours: number | null; avg_first: string | null;
};

// ISO weekday numbers, in the order of the Egyptian week.
const DAYS: [number, string][] = [[6, "السبت"], [7, "الحد"], [1, "الاتنين"], [2, "التلات"], [3, "الأربع"], [4, "الخميس"], [5, "الجمعة"]];
const MONTH_RE = /^\d{4}-\d{2}$/;

const cairoTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Minutes after the shift start (Cairo time) that `iso` falls on `day`. */
function minutesLate(iso: string, shiftStart: string) {
  const [h, m] = cairoTime(iso).split(":").map(Number);
  const [sh, sm] = shiftStart.split(":").map(Number);
  return h * 60 + m - (sh * 60 + sm);
}

export default async function AttendancePage({ searchParams }: PageProps<"/admin/attendance">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const today = cairoToday();
  const sp = await searchParams;
  const month = typeof sp.month === "string" && MONTH_RE.test(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const supabase = await createClient();

  const [settingsRes, monthRes, todayRes, peopleRes] = await Promise.all([
    supabase.from("work_settings").select("shift_start, grace_minutes, off_days").eq("id", 1).single(),
    supabase.rpc("attendance_month", { p_month: `${month}-01` }),
    supabase.from("attendance").select("user_id, first_seen, last_seen").eq("day", today),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).in("role", ["agent", "team_leader"]).order("full_name"),
  ]);
  const s = (settingsRes.data ?? { shift_start: "10:00:00", grace_minutes: 15, off_days: [5] }) as Settings;
  const shift = s.shift_start.slice(0, 5);
  const rows = (monthRes.data ?? []) as MonthRow[];
  const seen = new Map((todayRes.data ?? []).map((a) => [a.user_id, a]));
  const people = peopleRes.data ?? [];
  const isOffToday = s.off_days.includes(((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);
  const shiftStarted = minutesLate(new Date().toISOString(), shift) >= 0;

  const board = people.map((p) => {
    const a = seen.get(p.id);
    const late = a ? minutesLate(a.first_seen, shift) : 0;
    const state = a ? (late > s.grace_minutes ? "late" : "on_time") : isOffToday || !shiftStarted ? "not_yet" : "absent";
    return { ...p, a, late, state };
  });
  const count = (st: string) => board.filter((b) => b.state === st).length;
  const STATE: Record<string, { label: string; cls: string }> = {
    on_time: { label: "في المعاد", cls: "bg-emerald-100 text-emerald-800" },
    late: { label: "متأخر", cls: "bg-amber-100 text-amber-800" },
    absent: { label: "لسه مجاش", cls: "bg-rose-100 text-rose-700" },
    not_yet: { label: "—", cls: "bg-zinc-100 text-zinc-500" },
  };

  return (
    <>
      <PageHeader
        title={t("الحضور والانصراف")}
        subtitle={t("الحضور بيتسجل لوحده أول ما الموظف يفتح السيستم، والانصراف آخر مرة كان فاتحه — الشيفت بيبدأ {0}، والسماح {1} دقيقة", shift, s.grace_minutes)}
      />
      <SubTabs tabs={ATTENDANCE_TABS} current="/admin/attendance" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("حاضرين في المعاد")} value={count("on_time")} tone="good" icon={CalendarCheck} />
        <StatCard label={t("وصلوا متأخر")} value={count("late")} tone="warn" icon={Clock} />
        <StatCard label={isOffToday ? t("النهارده إجازة") : t("لسه مجوش")} value={isOffToday ? "—" : count("absent")} icon={CalendarCheck} />
      </div>

      <section className="card mt-6">
        <h2 className="card-title"><Clock size={18} className="text-brand-600" /> {t("النهارده")}</h2>
        {board.length === 0 ? (
          <Empty>{t("مفيش موظفين")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{t("الموظف")}</th><th>{t("الحالة")}</th><th>{t("الحضور")}</th><th>{t("آخر ظهور")}</th><th>{t("التأخير")}</th></tr></thead>
              <tbody>
                {board.map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold"><Link href={`/admin/agents/${b.id}`} className="hover:underline">{b.full_name}</Link></td>
                    <td><span className={`badge ${STATE[b.state].cls}`}>{t(STATE[b.state].label)}</span></td>
                    <td className="num">{cairoTime(b.a?.first_seen ?? null)}</td>
                    <td className="num">{cairoTime(b.a?.last_seen ?? null)}</td>
                    <td className="num text-sm">{b.state === "late" ? t("{0} د", b.late) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="card-title mb-0"><CalendarCheck size={18} className="text-teal-600" /> {t("تقرير الشهر")}</h2>
          <div className="flex items-center gap-1">
            <Link href={`/admin/attendance?month=${shiftMonth(month, -1)}`} className="btn-ghost px-2.5" aria-label={t("اللي قبله")}><ChevronRight size={17} className="ltr:rotate-180" /></Link>
            <span className="num px-2 font-semibold">{month}</span>
            {month < today.slice(0, 7) && <Link href={`/admin/attendance?month=${shiftMonth(month, 1)}`} className="btn-ghost px-2.5" aria-label={t("اللي بعده")}><ChevronLeft size={17} className="ltr:rotate-180" /></Link>}
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty>{t("مفيش بيانات للشهر ده")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{t("الموظف")}</th><th>{t("أيام الحضور")}</th><th>{t("أيام الغياب")}</th><th>{t("أيام التأخير")}</th><th>{t("دقايق التأخير")}</th><th>{t("متوسط الوصول")}</th><th>{t("متوسط الساعات")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id}>
                    <td className="font-semibold">{r.full_name}</td>
                    <td className="num">{r.present}</td>
                    <td className={`num ${r.absent > 0 ? "font-bold text-rose-600" : ""}`}>{r.absent}</td>
                    <td className={`num ${r.late_days > 0 ? "font-bold text-amber-600" : ""}`}>{r.late_days}</td>
                    <td className="num">{r.late_minutes}</td>
                    <td className="num">{r.avg_first?.slice(0, 5) ?? "—"}</td>
                    <td className="num">{r.avg_hours ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {MANAGERS.includes(me.role) && (
        <section className="card mt-6">
          <h2 className="card-title"><Settings2 size={18} className="text-zinc-500" /> {t("إعدادات الشيفت")}</h2>
          <StateForm action={saveWorkSettings} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="shift_start">{t("بداية الشيفت")}</label>
              <input id="shift_start" name="shift_start" type="time" defaultValue={shift} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="grace_minutes">{t("السماح بالدقايق قبل ما يتحسب تأخير")}</label>
              <input id="grace_minutes" name="grace_minutes" type="number" min={0} max={180} defaultValue={s.grace_minutes} required className="input" />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="label">{t("أيام الإجازة")}</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(([n, label]) => (
                  <label key={n} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm">
                    <input type="checkbox" name="off_days" value={n} defaultChecked={s.off_days.includes(n)} className="accent-brand-600" /> {t(label)}
                  </label>
                ))}
              </div>
            </fieldset>
          </StateForm>
        </section>
      )}
    </>
  );
}
