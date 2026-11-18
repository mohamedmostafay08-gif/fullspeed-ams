import { PageHeader } from "@/components/app-shell";
import { NotificationsList } from "@/components/notifications-list";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export default async function AgentNotificationsPage() {
  const t = await getT();
  const profile = await requireRole("agent");
  return (
    <>
      <PageHeader title={t("الإشعارات")} />
      <NotificationsList userId={profile.id} />
    </>
  );
}
