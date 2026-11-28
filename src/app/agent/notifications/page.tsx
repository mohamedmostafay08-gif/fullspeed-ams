import { PageHeader } from "@/components/app-shell";
import { NotificationsList } from "@/components/notifications-list";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { PushSettings } from "@/components/pwa";
import { AGENT_WORK_TABS, SubTabs } from "@/components/sub-tabs";
import { getPushPublicKey } from "@/lib/push";

export default async function AgentNotificationsPage() {
  const t = await getT();
  const profile = await requireRole("agent");
  return (
    <>
      <PageHeader title={t("المطلوب مني")} />
      <SubTabs tabs={AGENT_WORK_TABS} current="/agent/notifications" />
      <PushSettings publicKey={await getPushPublicKey()} />
      <NotificationsList userId={profile.id} />
    </>
  );
}
