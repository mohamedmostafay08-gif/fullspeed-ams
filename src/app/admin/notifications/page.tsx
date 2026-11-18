import { PageHeader } from "@/components/app-shell";
import { NotificationsList } from "@/components/notifications-list";
import { requireRole, STAFF } from "@/lib/auth";

export default async function AdminNotificationsPage() {
  const profile = await requireRole(...STAFF);
  return (
    <>
      <PageHeader title="الإشعارات" />
      <NotificationsList userId={profile.id} />
    </>
  );
}
