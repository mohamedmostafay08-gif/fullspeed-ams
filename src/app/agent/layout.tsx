import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { PresenceBeacon } from "@/components/presence";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/data";
import { pendingLocationCheck } from "@/lib/location-gate";

const NAV = [
  { href: "/agent", label: "يومي", icon: "dashboard", exact: true, mobile: "tab" },
  { href: "/agent/next", label: "ابدأ المكالمات", icon: "phone", mobile: "tab" },
  { href: "/agent/leads/new", label: "ليد جديد", icon: "add", exact: true, mobile: "fab" },
  { href: "/agent/leads", label: "الليدز بتاعتي", icon: "leads", exact: true, mobile: "tab" },
  { href: "/agent/tasks", label: "التاسكات", icon: "tasks" },
  { href: "/agent/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/agent/account", label: "حسابي", icon: "account" },
] as const;

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const profile = await requireRole("agent");
  // Reminder fallback for hosts without pg_cron: due call-backs/interviews notify on navigation.
  await (await createClient()).rpc("fire_due_reminders");
  const [unread, mustCheckIn] = await Promise.all([getUnreadCount(profile.id), pendingLocationCheck(profile)]);
  return (
    <AppShell profile={profile} nav={[...NAV]} unread={unread} notificationsHref="/agent/notifications">
      <PresenceBeacon userId={profile.id} />
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
