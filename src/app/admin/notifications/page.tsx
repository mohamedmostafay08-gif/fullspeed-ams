import { PageHeader } from "@/components/app-shell";
import { NotificationsList } from "@/components/notifications-list";
import { requireRole } from "@/lib/auth";

export default async function AdminNotificationsPage() {
  const profile = await requireRole("admin", "team_leader");
  return (
    <>
      <PageHeader title="الإشعارات" />
      <NotificationsList userId={profile.id} />
    </>
  );
}
