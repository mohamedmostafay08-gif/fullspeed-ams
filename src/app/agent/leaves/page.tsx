import { PageHeader } from "@/components/app-shell";
import { LEAVE_SELECT, LeaveRequestForm, MyLeaves, type Leave } from "@/components/leaves";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AgentLeavesPage() {
  const t = await getT();
  const me = await requireRole("agent");
  const supabase = await createClient();
  const { data } = await supabase.from("leave_requests").select(LEAVE_SELECT).eq("user_id", me.id).order("start_date", { ascending: false }).limit(50);
  return (
    <>
      <PageHeader title={t("الإجازات")} subtitle={t("اطلب إجازتك من هنا، وهيوصلك إشعار لما التيم ليدر يرد")} />
      <div className="space-y-6">
        <LeaveRequestForm />
        <MyLeaves rows={(data ?? []) as unknown as Leave[]} />
      </div>
    </>
  );
}
