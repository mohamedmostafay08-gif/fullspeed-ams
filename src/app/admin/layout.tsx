import { AppShell } from "@/components/app-shell";
import { GeoGate } from "@/components/geo-gate";
import { requireRole, STAFF } from "@/lib/auth";
import { getUnreadCount } from "@/lib/data";
import { pendingLocationCheck } from "@/lib/location-gate";
import type { Role } from "@/lib/types";

type Item = { href: string; label: string; icon: string; exact?: boolean; roles?: Role[]; mobile?: "tab" | "fab"; desktop?: false };

const NAV: Item[] = [
  { href: "/admin", label: "لوحة التحكم", icon: "dashboard", exact: true, mobile: "tab" },
  { href: "/admin/live", label: "المتابعة اللايف", icon: "live", mobile: "tab" },
  { href: "/admin/leads/new", label: "ليد جديد", icon: "add", mobile: "fab", desktop: false },
  { href: "/admin/analytics", label: "التحليلات", icon: "analytics" },
  { href: "/admin/report", label: "التقرير اليومي", icon: "report" },
  { href: "/admin/leads", label: "الليدز", icon: "leads", mobile: "tab" },
  { href: "/admin/agents", label: "الفريق", icon: "team" },
  { href: "/admin/breaks", label: "البريكات", icon: "coffee" },
  { href: "/admin/companies", label: "الشركات", icon: "companies" },
  { href: "/admin/tasks", label: "التاسكات", icon: "tasks" },
  { href: "/admin/announcements", label: "البونص والإشعارات", icon: "bonus" },
  { href: "/admin/templates", label: "قوالب واتساب", icon: "whatsapp" },
  { href: "/admin/blacklist", label: "البلاك ليست", icon: "ban" },
  { href: "/admin/locations", label: "أماكن الشغل", icon: "location", roles: ["admin", "manager"] },
  { href: "/admin/audit", label: "سجل التعديلات", icon: "audit", roles: ["admin", "manager"] },
  { href: "/admin/crm", label: "ربط الـ CRM", icon: "crm", roles: ["admin"] },
  { href: "/admin/account", label: "حسابي", icon: "account" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireRole(...STAFF);
  const [unread, mustCheckIn] = await Promise.all([getUnreadCount(profile.id), pendingLocationCheck(profile)]);
  const nav = NAV.filter((n) => !n.roles || n.roles.includes(profile.role)).map(({ href, label, icon, exact, mobile, desktop }) => ({ href, label, icon, exact, mobile, desktop }));
  return (
    <AppShell profile={profile} nav={nav} unread={unread} notificationsHref="/admin/notifications">
      {mustCheckIn ? <GeoGate locationName={mustCheckIn} /> : children}
    </AppShell>
  );
}
