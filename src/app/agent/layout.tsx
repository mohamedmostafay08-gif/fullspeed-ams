import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { getUnreadCount } from "@/lib/data";

const NAV = [
  { href: "/agent", label: "يومي", icon: "dashboard", exact: true },
  { href: "/agent/leads/new", label: "ليد جديد", icon: "add", exact: true },
  { href: "/agent/leads", label: "الليدز بتاعتي", icon: "leads", exact: true },
  { href: "/agent/tasks", label: "التاسكات", icon: "tasks" },
  { href: "/agent/notifications", label: "الإشعارات", icon: "bell" },
] as const;

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const profile = await requireRole("agent");
  const unread = await getUnreadCount(profile.id);
  return (
    <AppShell profile={profile} nav={[...NAV]} unread={unread} notificationsHref="/agent/notifications">
      {children}
    </AppShell>
  );
}
