import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { AttendanceBeacon } from "@/components/presence";
import { getSession, requireRole, STAFF } from "@/lib/auth";
import { pendingLocationCheck } from "@/lib/location-gate";
import type { Role } from "@/lib/types";

type Item = { href: string; label: string; icon: string; exact?: boolean; also?: string[]; roles?: Role[]; mobile?: "tab" | "fab"; desktop?: false };

const NAV: Item[] = [
  { href: "/admin", label: "لوحة التحكم", icon: "dashboard", exact: true, mobile: "tab" },
  { href: "/admin/live", label: "المتابعة اللايف", icon: "live", mobile: "tab" },
  { href: "/admin/leads/new", label: "ليد جديد", icon: "add", mobile: "fab", desktop: false },
  { href: "/admin/analytics", label: "التحليلات", icon: "analytics" },
  { href: "/admin/report", label: "التقرير اليومي", icon: "report" },
  { href: "/admin/leads", label: "الليدز", icon: "leads", mobile: "tab" },
  { href: "/admin/agents", label: "الفريق", icon: "team" },
  { href: "/admin/teams", label: "التيمات", icon: "teams" },
  { href: "/admin/attendance", label: "الحضور والبريكات", icon: "attendance", also: ["/admin/breaks"] },
  { href: "/admin/scorecard", label: "التقييم", icon: "scorecard" },
  { href: "/admin/tasks", label: "التاسكات والتعميمات", icon: "tasks", also: ["/admin/memos"] },
  { href: "/admin/companies", label: "الشركات", icon: "companies" },
  { href: "/admin/announcements", label: "البونص والإشعارات", icon: "bonus" },
  { href: "/admin/templates", label: "قوالب واتساب", icon: "whatsapp" },
  { href: "/admin/blacklist", label: "البلاك ليست", icon: "ban" },
  { href: "/admin/locations", label: "أماكن الشغل", icon: "location", roles: ["admin", "manager"] },
  { href: "/admin/requests", label: "طلبات الموافقة", icon: "requests", roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/audit", label: "سجل التعديلات", icon: "audit", roles: ["admin", "manager"] },
  { href: "/admin/logins", label: "سجل الدخول", icon: "logins", roles: ["admin"] },
  { href: "/admin/crm", label: "ربط الـ CRM", icon: "crm", roles: ["admin"] },
  { href: "/admin/integrations", label: "النسخ والتكاملات", icon: "backup", roles: ["admin"] },
  { href: "/admin/account", label: "حسابي", icon: "account" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireRole(...STAFF);
  const session = (await getSession())!;
  const unread = session.unread;
  const mustCheckIn = pendingLocationCheck(session);
  const nav = NAV.filter((n) => !n.roles || n.roles.includes(profile.role)).map(({ href, label, icon, exact, also, mobile, desktop }) => ({ href, label, icon, exact, also, mobile, desktop }));
  return (
    <AppShell profile={profile} nav={nav} unread={unread} notificationsHref="/admin/notifications">
      {profile.role === "team_leader" && !mustCheckIn && <AttendanceBeacon />}
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
