import { PageHeader } from "@/components/app-shell";
import { LeaveCalendar } from "@/components/leave-calendar";
import {
  Holidays, LEAVE_SELECT, LeaveRequestForm, LeavesTable, LeavesToDecide, MyLeaves, MyPermits, PERMIT_SELECT,
  PermitRequestForm, PermitsToDecide, type Holiday, type Leave, type Permit,
} from "@/components/leaves";
import { ATTENDANCE_TABS, SubTabs } from "@/components/sub-tabs";
import { MANAGERS, STAFF, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Load = { team: number; peak: number; peak_day: string | null };

export default async function AdminLeavesPage({ searchParams }: PageProps<"/admin/leaves">) {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const sp = await searchParams;
  const today = cairoToday();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const supabase = await createClient();
  const monthEnd = addMonths(`${month}-01`, 1).slice(0, 8) + "01";

  const [leavesRes, permitsRes, holidaysRes, settingsRes, peopleRes, calRes] = await Promise.all([
    supabase.from("leave_requests").select(LEAVE_SELECT).order("start_date", { ascending: false }).limit(300),
    supabase.from("hour_permits").select(PERMIT_SELECT).gte("day", addMonths(today, -2)).order("day", { ascending: false }).limit(300),
    supabase.from("public_holidays").select("day, name").gte("day", `${month}-01` < today ? `${month}-01` : today).order("day").limit(120),
    supabase.from("work_settings").select("off_days").eq("id", 1).single(),
    supabase.from("profiles").select("id, team_id, role").eq("is_active", true),
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
  const closed = others.filter((l) => l.status !== "pending");
  const pendingPermits = permits.filter((p) => p.user_id !== me.id && p.status === "pending");
  const myPermits = permits.filter((p) => p.user_id === me.id);

  // How full each requester's team already is on their busiest day.
  const loads = await Promise.all(
    pending.map(async (l) => [l.id, (await supabase.rpc("team_leave_load", { p_user: l.user_id, p_from: l.start_date, p_to: l.end_date })).data as Load] as const),
  );

  return (
    <>
      <PageHeader title={t("الإجازات والأذونات")} subtitle={t("الأجنت بيطلب، والتيم ليدر بتاعه أو المدير يوافق. التيم ليدر بيوافقله المدير أو الأدمن.")} />
      <SubTabs tabs={ATTENDANCE_TABS} current="/admin/leaves" />
      {outToday.length > 0 && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          🌴 {t("في إجازة النهارده:")} <b>{outToday.map((l) => l.person?.full_name).join("، ")}</b>
        </p>
      )}
      <div className="space-y-6">
        <LeavesToDecide rows={pending} load={Object.fromEntries(loads.filter(([, v]) => v))} />
        <PermitsToDecide rows={pendingPermits} />
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
        <LeavesTable rows={closed} title={t("كل الإجازات")} />
      </div>
    </>
  );
}

function addMonths(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
