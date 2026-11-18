import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { getUnreadCount } from "@/lib/data";

const NAV = [
  { href: "/admin", label: "لوحة التحكم", icon: "dashboard", exact: true },
  { href: "/admin/leads", label: "الليدز", icon: "leads" },
  { href: "/admin/agents", label: "الفريق", icon: "team" },
  { href: "/admin/companies", label: "الشركات", icon: "companies" },
  { href: "/admin/tasks", label: "التاسكات", icon: "tasks" },
  { href: "/admin/announcements", label: "البونص والإشعارات", icon: "bonus" },
  { href: "/admin/crm", label: "ربط الـ CRM", icon: "crm" },
] as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireRole("admin", "team_leader");
  const unread = await getUnreadCount(profile.id);
  return (
    <AppShell profile={profile} nav={[...NAV]} unread={unread} notificationsHref="/admin/notifications">
      {children}
    </AppShell>
  );
}
