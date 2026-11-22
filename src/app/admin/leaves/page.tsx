import { PageHeader } from "@/components/app-shell";
import { LEAVE_SELECT, LeaveRequestForm, LeavesTable, LeavesToDecide, MyLeaves, type Leave } from "@/components/leaves";
import { ATTENDANCE_TABS, SubTabs } from "@/components/sub-tabs";
import { STAFF, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AdminLeavesPage() {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const supabase = await createClient();
  const { data } = await supabase.from("leave_requests").select(LEAVE_SELECT).order("start_date", { ascending: false }).limit(300);
  const rows = (data ?? []) as unknown as Leave[];
  const mine = rows.filter((l) => l.user_id === me.id);
  const others = rows.filter((l) => l.user_id !== me.id);
  const today = cairoToday();
  const pending = others.filter((l) => l.status === "pending").sort((a, b) => a.start_date.localeCompare(b.start_date));
  const outToday = others.filter((l) => l.status === "approved" && l.start_date <= today && l.end_date >= today);
  const closed = others.filter((l) => l.status !== "pending");

  return (
    <>
      <PageHeader title={t("الإجازات")} subtitle={t("الأجنت بيطلب، والتيم ليدر بتاعه أو المدير يوافق. التيم ليدر بيوافقله المدير أو الأدمن.")} />
      <SubTabs tabs={ATTENDANCE_TABS} current="/admin/leaves" />
      {outToday.length > 0 && (
        <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          🌴 {t("في إجازة النهارده:")} <b>{outToday.map((l) => l.person?.full_name).join("، ")}</b>
        </p>
      )}
      <div className="space-y-6">
        <LeavesToDecide rows={pending} />
        {me.role !== "admin" && <LeaveRequestForm />}
        {me.role !== "admin" && <MyLeaves rows={mine} />}
        <LeavesTable rows={closed} title={t("كل الإجازات")} />
      </div>
    </>
  );
}
