import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { AttendanceBeacon, PresenceBeacon } from "@/components/presence";
import { getSession, requireRole } from "@/lib/auth";
import { pendingLocationCheck } from "@/lib/location-gate";

const NAV = [
  { href: "/agent", label: "يومي", icon: "dashboard", exact: true, mobile: "tab" },
  { href: "/agent/today", label: "شاشة اليوم", icon: "today" },
  { href: "/agent/next", label: "ابدأ المكالمات", icon: "phone", mobile: "tab" },
  { href: "/agent/leads/new", label: "ليد جديد", icon: "add", exact: true, mobile: "fab" },
  { href: "/agent/leads", label: "الليدز بتاعتي", icon: "leads", exact: true, mobile: "tab" },
  { href: "/agent/tasks", label: "التاسكات والتعميمات", icon: "tasks", also: ["/agent/memos"] },
  { href: "/agent/scorecard", label: "تقييمي", icon: "scorecard" },
  { href: "/agent/leaves", label: "الإجازات والأذونات", icon: "leave" },
  { href: "/agent/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/agent/account", label: "حسابي", icon: "account" },
] as const;

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const profile = await requireRole("agent");
  const session = (await getSession())!;
  const unread = session.unread;
  const mustCheckIn = pendingLocationCheck(session);
  return (
    <AppShell profile={profile} nav={[...NAV]} unread={unread} notificationsHref="/agent/notifications">
      <PresenceBeacon userId={profile.id} />
      {!mustCheckIn && <AttendanceBeacon />}
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
