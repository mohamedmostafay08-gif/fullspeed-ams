import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/app-shell";
import { LeaveCalendar } from "@/components/leave-calendar";
import {
  Holidays, LEAVE_SELECT, LeaveRequestForm, LeavesTable, MyLeaves, MyPermits, PERMIT_SELECT,
  LEAVE_KINDS, PermitRequestForm, type Holiday, type Leave, type Permit,
} from "@/components/leaves";
import { ATTENDANCE_TABS, SubTabs } from "@/components/sub-tabs";
import { PendingInApprovals } from "@/components/pending-note";
import { MANAGERS, STAFF, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";


export default async function AdminLeavesPage({ searchParams }: PageProps<"/admin/leaves">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const sp = await searchParams;
  const today = cairoToday();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const fTeam = /^[0-9a-f-]{36}$/i.test(str("team")) ? str("team") : "";
  const fQ = str("q").trim().slice(0, 60);
  const fStatus = ["approved", "rejected", "cancelled"].includes(str("status")) ? str("status") : "";
  const fKind = Object.hasOwn(LEAVE_KINDS, str("kind")) ? str("kind") : "";
  const fFrom = DAY.test(str("from")) ? str("from") : "";
  const fTo = DAY.test(str("to")) ? str("to") : "";
  const supabase = await createClient();
  const monthEnd = addMonths(`${month}-01`, 1).slice(0, 8) + "01";

  const [leavesRes, permitsRes, holidaysRes, settingsRes, peopleRes, teamsRes, calRes] = await Promise.all([
    supabase.from("leave_requests").select(LEAVE_SELECT).order("start_date", { ascending: false }).limit(300),
    supabase.from("hour_permits").select(PERMIT_SELECT).gte("day", addMonths(today, -2)).order("day", { ascending: false }).limit(300),
    supabase.from("public_holidays").select("day, name").gte("day", `${month}-01` < today ? `${month}-01` : today).order("day").limit(120),
    supabase.from("work_settings").select("off_days").eq("id", 1).single(),
    supabase.from("profiles").select("id, team_id, role").eq("is_active", true),
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("leave_requests").select("user_id, start_date, end_date, status, person:profiles!leave_requests_user_id_fkey(full_name)")
      .in("status", ["approved", "pending"]).lt("start_date", monthEnd).gte("end_date", `${month}-01`),
  ]);
  const rows = (leavesRes.data ?? []) as unknown as Leave[];
  const permits = (permitsRes.data ?? []) as unknown as Permit[];
  const holidays = (holidaysRes.data ?? []) as Holiday[];
  const people = peopleRes.data ?? [];
  const teamOf = new Map(people.map((p) => [p.id, p.team_id as string | null]));
  const teamSize: Record<string, number> = {};
  for (const p of people) if (p.role === "agent" && p.team_id) teamSize[p.team_id] = (teamSize[p.team_id] ?? 0) + 1;

  const mine = rows.filter((l) => l.user_id === me.id);
  const others = rows.filter((l) => l.user_id !== me.id);
  const pending = others.filter((l) => l.status === "pending").sort((a, b) => a.start_date.localeCompare(b.start_date));
  const outToday = others.filter((l) => l.status === "approved" && l.start_date <= today && l.end_date >= today);
  const closed = others.filter((l) =>
    l.status !== "pending" &&
    (!fTeam || teamOf.get(l.user_id) === fTeam) &&
    (!fQ || (l.person?.full_name ?? "").toLowerCase().includes(fQ.toLowerCase())) &&
    (!fStatus || l.status === fStatus) &&
    (!fKind || l.kind === fKind) &&
    (!fFrom || l.end_date >= fFrom) &&
    (!fTo || l.start_date <= fTo));
  const anyF = !!(fTeam || fQ || fStatus || fKind || fFrom || fTo);
  const pendingPermits = permits.filter((p) => p.user_id !== me.id && p.status === "pending");
  const myPermits = permits.filter((p) => p.user_id === me.id);



  return (
    <>
      <PageHeader title={t("الإجازات والأذونات")} subtitle={t("الأجنت بيطلب، والتيم ليدر بتاعه أو المدير يوافق. التيم ليدر بيوافقله المدير أو الأدمن.")} />
      <SubTabs tabs={ATTENDANCE_TABS} current="/admin/leaves" />
      {outToday.length > 0 && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          🌴 {t("في إجازة النهارده:")} <b>{outToday.map((l) => l.person?.full_name).join("، ")}</b>
        </p>
      )}
      <PendingInApprovals count={pending.length + pendingPermits.length} label={t("{0} طلب إجازة أو إذن مستني ردك", pending.length + pendingPermits.length)} />
      <div className="space-y-6">
        <LeaveCalendar
          month={month}
          today={today}
          path="/admin/leaves"
          offDays={(settingsRes.data?.off_days as number[]) ?? [5]}
          teamSize={teamSize}
          holidays={Object.fromEntries(holidays.map((h) => [h.day, h.name]))}
          leaves={((calRes.data ?? []) as unknown as (Pick<Leave, "user_id" | "start_date" | "end_date" | "person"> & { status: "approved" | "pending" })[]).map((l) => ({
            user_id: l.user_id,
            start_date: l.start_date,
            end_date: l.end_date,
            status: l.status,
            name: l.person?.full_name ?? "—",
            team_id: teamOf.get(l.user_id) ?? null,
          }))}
        />
        <Holidays rows={holidays.filter((h) => h.day >= today)} canEdit={MANAGERS.includes(me.role)} />
        {me.role !== "admin" && (
          <div className="grid gap-6 xl:grid-cols-2">
            <LeaveRequestForm />
            <PermitRequestForm />
          </div>
        )}
        {me.role !== "admin" && <MyLeaves rows={mine} />}
        {me.role !== "admin" && <MyPermits rows={myPermits} />}
        <FilterBar clearHref={`/admin/leaves?month=${month}`} active={Boolean(anyF)}>
          <input type="hidden" name="month" value={month} />
          <input name="q" defaultValue={fQ} placeholder={t("اسم الموظف")} className="input" aria-label={t("اسم الموظف")} />
          <select name="team" defaultValue={fTeam} className="input" aria-label={t("التيم")}>
            <option value="">{t("كل التيمات")}</option>
            {(teamsRes.data ?? []).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
          <select name="status" defaultValue={fStatus} className="input" aria-label={t("الحالة")}>
            <option value="">{t("كل الحالات")}</option>
            <option value="approved">{t("اتوافق عليها")}</option>
            <option value="rejected">{t("اترفضت")}</option>
            <option value="cancelled">{t("اتلغت")}</option>
          </select>
          <select name="kind" defaultValue={fKind} className="input" aria-label={t("نوع الإجازة")}>
            <option value="">{t("كل الأنواع")}</option>
            {Object.entries(LEAVE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
          <input type="date" name="from" defaultValue={fFrom} className="input" aria-label={t("من")} />
          <input type="date" name="to" defaultValue={fTo} className="input" aria-label={t("إلى")} />
        </FilterBar>
        <LeavesTable rows={closed} title={anyF ? t("الإجازات ({0})", closed.length) : t("كل الإجازات")} />
      </div>
    </>
  );
}

function addMonths(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
