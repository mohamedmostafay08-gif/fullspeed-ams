import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { getUnreadCount } from "@/lib/data";

const NAV = [
  { href: "/agent", label: "يومي", exact: true },
  { href: "/agent/leads/new", label: "+ ليد جديد", exact: true },
  { href: "/agent/leads", label: "الليدز بتاعتي", exact: true },
  { href: "/agent/tasks", label: "التاسكات" },
  { href: "/agent/notifications", label: "الإشعارات" },
];

export default function AgentLayout({ children }: LayoutProps<"/agent">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AgentShell>{children}</AgentShell>
    </Suspense>
  );
}

async function AgentShell({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("agent");
  const unread = await getUnreadCount(profile.id);
  return (
    <AppShell profile={profile} nav={NAV} unread={unread} notificationsHref="/agent/notifications">
      {children}
    </AppShell>
  );
}
