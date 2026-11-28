import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { AttendanceBeacon } from "@/components/presence";
import { getSession, requireRole, VIEWERS } from "@/lib/auth";
import { pendingLocationCheck } from "@/lib/location-gate";
import { createClient } from "@/lib/supabase/server";
import { SETTINGS_PAGES, settingsFor } from "@/lib/settings-pages";
import type { Role } from "@/lib/types";

type Badge = "approvals" | "distribute" | "wa";
type Item = { href: string; label: string; icon: string; group: string; exact?: boolean; also?: string[]; roles?: Role[]; mobile?: "tab" | "fab"; desktop?: false; perf?: true; badge?: Badge };

// Grouped by the job: daily work first, team second, numbers third, setup last (folded).
const NAV: Item[] = [
  { group: "الرئيسية", href: "/admin", label: "لوحة التحكم", icon: "dashboard", exact: true, mobile: "tab", perf: true },
  { group: "الرئيسية", href: "/admin/live", label: "المتابعة اللايف", icon: "live", perf: true },
  { group: "الرئيسية", href: "/admin/approvals", label: "الموافقات", icon: "approvals", mobile: "tab", badge: "approvals", roles: ["admin", "manager", "team_leader"] },
  { group: "الليدز", href: "/admin/leads/new", label: "ليد جديد", icon: "add", mobile: "fab", desktop: false },
  { group: "الليدز", href: "/admin/leads", label: "الليدز", icon: "leads", mobile: "tab" },
  { group: "الليدز", href: "/admin/facebook-leads", label: "ليدز للتوزيع", icon: "memo", roles: ["admin", "manager"], badge: "distribute" },
  { group: "الليدز", href: "/admin/inbox", label: "واتساب", icon: "whatsapp", badge: "wa" },
  { group: "الليدز", href: "/admin/distribution", label: "التوزيع والمهلة", icon: "distribution", perf: true },
  { group: "الفريق", href: "/admin/agents", label: "الفريق", icon: "team" },
  { group: "الفريق", href: "/admin/teams", label: "التيمات", icon: "teams", perf: true },
  { group: "الفريق", href: "/admin/attendance", label: "الحضور والإجازات", icon: "attendance", also: ["/admin/breaks", "/admin/leaves"] },
  { group: "الفريق", href: "/admin/tasks", label: "التاسكات والرسايل", icon: "tasks", also: ["/admin/memos", "/admin/announcements"] },
  { group: "الفريق", href: "/admin/scorecard", label: "التقييم", icon: "scorecard", perf: true },
  { group: "التقارير", href: "/admin/analytics", label: "التحليلات", icon: "analytics", perf: true },
  { group: "التقارير", href: "/admin/report", label: "التقرير اليومي", icon: "report", perf: true },
  { group: "التقارير", href: "/admin/campaigns", label: "مسار الحملات", icon: "campaigns", perf: true },
  { group: "الإعدادات", href: "/admin/companies", label: "الشركات", icon: "companies" },
  { group: "الإعدادات", href: "/admin/settings", label: "كل الإعدادات", icon: "settings", perf: true, also: SETTINGS_PAGES.map((p) => p.href) },
];

/** Menu badge counts, from one database call. Missing function (migration not applied yet) → no badges. */
async function navBadges(): Promise<Partial<Record<Badge, number>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("nav_badges");
  return error || !data ? {} : (data as Partial<Record<Badge, number>>);
}

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireRole(...VIEWERS);
  const session = (await getSession())!;
  const unread = session.unread;
  const mustCheckIn = pendingLocationCheck(session);
  const isPerf = profile.role === "performance";
  const badges = isPerf ? {} : await navBadges();
  const nav = NAV.filter((n) => (isPerf ? n.perf : !n.roles || n.roles.includes(profile.role))).map(({ href, label, icon, group, exact, also, mobile, desktop, badge }) => ({
    href, label, icon, group, exact, also, desktop,
    // "Performance" has no leads or approvals: their phone bar is dashboard, live and analytics.
    mobile: isPerf ? (["/admin", "/admin/live", "/admin/analytics"].includes(href) ? ("tab" as const) : undefined) : mobile,
    badge: badge ? badges[badge] : undefined,
  }));
  return (
    <AppShell profile={profile} nav={nav} extraSearch={settingsFor(profile.role).map(({ href, label }) => ({ href, label, group: "الإعدادات" }))} unread={unread} notificationsHref="/admin/notifications">
      {profile.role === "team_leader" && !mustCheckIn && <AttendanceBeacon />}
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
