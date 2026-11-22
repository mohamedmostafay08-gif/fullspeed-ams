import { PageHeader } from "@/components/app-shell";
import { Holidays, LEAVE_SELECT, LeaveRequestForm, MyLeaves, MyPermits, PERMIT_SELECT, PermitRequestForm, type Holiday, type Leave, type Permit } from "@/components/leaves";
import { cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AgentLeavesPage() {
  const t = await getT();
  const me = await requireRole("agent");
  const supabase = await createClient();
  const [leaves, permits, holidays] = await Promise.all([
    supabase.from("leave_requests").select(LEAVE_SELECT).eq("user_id", me.id).order("start_date", { ascending: false }).limit(50),
    supabase.from("hour_permits").select(PERMIT_SELECT).eq("user_id", me.id).order("day", { ascending: false }).limit(30),
    supabase.from("public_holidays").select("day, name").gte("day", cairoToday()).order("day").limit(20),
  ]);
  return (
    <>
      <PageHeader title={t("الإجازات والأذونات")} subtitle={t("اطلب إجازة أو إذن من هنا، وهيوصلك إشعار لما التيم ليدر يرد")} />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <LeaveRequestForm />
          <PermitRequestForm />
        </div>
        <MyLeaves rows={(leaves.data ?? []) as unknown as Leave[]} />
        <MyPermits rows={(permits.data ?? []) as unknown as Permit[]} />
        <Holidays rows={(holidays.data ?? []) as Holiday[]} canEdit={false} />
      </div>
    </>
  );
}
