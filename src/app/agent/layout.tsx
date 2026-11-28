import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { AttendanceBeacon, PresenceBeacon } from "@/components/presence";
import { getSession, requireRole } from "@/lib/auth";
import { pendingLocationCheck } from "@/lib/location-gate";
import { createClient } from "@/lib/supabase/server";

type Badge = "wa" | "tasks";
const NAV: { href: string; label: string; icon: string; group: string; exact?: boolean; also?: string[]; mobile?: "tab" | "fab"; desktop?: false; badge?: Badge }[] = [
  { group: "شغلي", href: "/agent", label: "اليوم", icon: "today", exact: true, mobile: "tab", also: ["/agent/today"] },
  { group: "شغلي", href: "/agent/next", label: "ابدأ المكالمات", icon: "phone", mobile: "fab" },
  { group: "شغلي", href: "/agent/leads", label: "الليدز بتاعتي", icon: "leads", mobile: "tab" },
  { group: "شغلي", href: "/agent/inbox", label: "واتساب", icon: "whatsapp", mobile: "tab", badge: "wa" },
  { group: "أنا", href: "/agent/tasks", label: "التاسكات والتعميمات", icon: "tasks", also: ["/agent/memos"], badge: "tasks" },
  { group: "أنا", href: "/agent/scorecard", label: "تقييمي", icon: "scorecard" },
  { group: "أنا", href: "/agent/leaves", label: "الإجازات والأذونات", icon: "leave" },
  { group: "أنا", href: "/agent/notifications", label: "الإشعارات", icon: "bell" },
  { group: "أنا", href: "/agent/account", label: "حسابي", icon: "account" },
];

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const profile = await requireRole("agent");
  const session = (await getSession())!;
  const unread = session.unread;
  const mustCheckIn = pendingLocationCheck(session);
  const supabase = await createClient();
  const { data } = await supabase.rpc("nav_badges"); // missing until migration 0049 → no badges
  const badges = (data ?? {}) as Partial<Record<Badge, number>>;
  const nav = NAV.map(({ badge, ...n }) => ({ ...n, badge: badge ? badges[badge] : undefined }));
  return (
    <AppShell profile={profile} nav={nav} unread={unread} notificationsHref="/agent/notifications">
      <PresenceBeacon userId={profile.id} />
      {!mustCheckIn && <AttendanceBeacon />}
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
