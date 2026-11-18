import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { getUnreadCount } from "@/lib/data";

const NAV = [
  { href: "/admin", label: "لوحة التحكم", exact: true },
  { href: "/admin/leads", label: "الليدز" },
  { href: "/admin/agents", label: "الفريق" },
  { href: "/admin/companies", label: "الشركات" },
  { href: "/admin/tasks", label: "التاسكات" },
  { href: "/admin/announcements", label: "البونص والإشعارات" },
  { href: "/admin/crm", label: "ربط الـ CRM" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("admin", "team_leader");
  const unread = await getUnreadCount(profile.id);
  return (
    <AppShell profile={profile} nav={NAV} unread={unread} notificationsHref="/admin/notifications">
      {children}
    </AppShell>
  );
}
