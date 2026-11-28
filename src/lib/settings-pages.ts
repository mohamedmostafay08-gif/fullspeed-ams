import type { Role } from "@/lib/types";

/** Setup pages that live behind «الإعدادات» instead of the main menu. Shared by the menu, the settings page and quick search. */
export const SETTINGS_PAGES: { href: string; label: string; icon: string; hint: string; roles?: Role[]; tabOf?: string }[] = [
  { href: "/admin/templates", label: "قوالب واتساب", icon: "templates", hint: "رسايل الترحيب والتذكير الجاهزة" },
  { href: "/admin/blacklist", label: "البلاك ليست", icon: "ban", hint: "أرقام ممنوع تدخل كليدز" },
  { href: "/admin/locations", label: "أماكن الشغل", icon: "location", hint: "المكان اللي كل أجنت يسجّل منه", roles: ["admin", "manager"] },
  { href: "/admin/requests", label: "طلبات الحسابات", icon: "requests", hint: "إيقاف أو تفعيل حسابات بموافقة الأدمن", roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/audit", label: "السجلات", icon: "audit", hint: "مين غيّر إيه وإمتى، ومين دخل من أي جهاز", roles: ["admin", "manager"] },
  { href: "/admin/logins", label: "سجل الدخول", icon: "logins", hint: "الأجهزة والخروج الإجباري", roles: ["admin"], tabOf: "/admin/audit" },
  { href: "/admin/crm", label: "ربط الـ CRM", icon: "crm", hint: "مفاتيح الـ API ومصادر الليدز", roles: ["admin"], tabOf: "/admin/integrations" },
  { href: "/admin/integrations", label: "التكاملات والـ CRM", icon: "backup", hint: "النسخة الاحتياطية وواتساب وميتا وLineCRM، ومفاتيح الـ CRM", roles: ["admin"] },
  { href: "/admin/account", label: "حسابي", icon: "account", hint: "الباسورد والبصمة والإشعارات" },
];

export function settingsFor(role: Role) {
  return SETTINGS_PAGES.filter((p) => !p.roles || p.roles.includes(role));
}
