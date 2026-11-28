import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { AttendanceBeacon, PresenceBeacon } from "@/components/presence";
import { getSession, requireRole } from "@/lib/auth";
import { pendingLocationCheck } from "@/lib/location-gate";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { getViewAs } from "@/lib/view-as";
import { ViewAsBanner } from "@/components/view-as-banner";

type Badge = "wa" | "tasks";
const NAV: { href: string; label: string; icon: string; group: string; exact?: boolean; also?: string[]; mobile?: "tab" | "fab"; desktop?: false; badge?: Badge }[] = [
  { group: "شغلي", href: "/agent", label: "اليوم", icon: "today", exact: true, mobile: "tab", also: ["/agent/today"] },
  { group: "شغلي", href: "/agent/next", label: "ابدأ المكالمات", icon: "phone", mobile: "fab" },
  { group: "شغلي", href: "/agent/leads", label: "الليدز بتاعتي", icon: "leads", mobile: "tab" },
  { group: "شغلي", href: "/agent/inbox", label: "واتساب", icon: "whatsapp", mobile: "tab", badge: "wa" },
  { group: "شغلي", href: "/agent/companies", label: "شركاتي", icon: "companies" },
  { group: "أنا", href: "/agent/tasks", label: "المطلوب مني", icon: "tasks", also: ["/agent/memos", "/agent/notifications"], badge: "tasks" },
  { group: "أنا", href: "/agent/scorecard", label: "تقييمي", icon: "scorecard" },
  { group: "أنا", href: "/agent/leaves", label: "الإجازات والأذونات", icon: "leave" },
  { group: "أنا", href: "/agent/account", label: "حسابي", icon: "account" },
];

export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const view = await getViewAs();
  if (view) return <ViewAsLayout agent={view.agent}>{children}</ViewAsLayout>;
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

/**
 * «شوف كأجنت»: the same menu and pages with the agent's data, read-only. No presence or attendance
 * beacons (they would mark the agent online), no location gate, and the banner is the way out.
 */
async function ViewAsLayout({ agent, children }: { agent: Profile; children: React.ReactNode }) {
  const supabase = await createClient();
  const [agentsRes, tasksRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).in("status", ["pending", "in_progress"]),
  ]);
  const agents = agentsRes.data ?? [];
  if (!agents.some((a) => a.id === agent.id)) agents.unshift({ id: agent.id, full_name: agent.full_name });
  const nav = NAV.map(({ badge, ...n }) => ({ ...n, badge: badge === "tasks" ? tasksRes.count ?? undefined : undefined }));
  return (
    <AppShell
      profile={agent}
      nav={nav}
      unread={0}
      notificationsHref="/agent/notifications"
      readOnly
      banner={<ViewAsBanner agentId={agent.id} agentName={agent.full_name} agents={agents} />}
    >
      {children}
    </AppShell>
  );
}
