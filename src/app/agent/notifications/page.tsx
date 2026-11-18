import { PageHeader } from "@/components/app-shell";
import { NotificationsList } from "@/components/notifications-list";
import { requireRole } from "@/lib/auth";

export default async function AgentNotificationsPage() {
  const profile = await requireRole("agent");
  return (
    <>
      <PageHeader title="الإشعارات" />
      <NotificationsList userId={profile.id} />
    </>
  );
}
