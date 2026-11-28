import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import type { Role } from "@/lib/types";

type Tab = { href: string; label: string; roles?: Role[] };

/** Tabs that join two related pages under one menu item. */
export async function SubTabs({ tabs, current, role }: { tabs: Tab[]; current: string; role?: Role }) {
  const t = await getT();
  const shown = tabs.filter((x) => !x.roles || !role || x.roles.includes(role));
  if (shown.length < 2) return null;
  return (
    <div className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1">
      {shown.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition ${tab.href === current ? "bg-white text-(--fg) shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          {t(tab.label)}
        </Link>
      ))}
    </div>
  );
}

export const ATTENDANCE_TABS = [
  { href: "/admin/attendance", label: "الحضور والانصراف" },
  { href: "/admin/breaks", label: "البريكات" },
  { href: "/admin/leaves", label: "الإجازات والأذونات" },
];
export const ADMIN_WORK_TABS = [
  { href: "/admin/tasks", label: "التاسكات" },
  { href: "/admin/memos", label: "التعميمات" },
  { href: "/admin/announcements", label: "البونص والإشعارات" },
];
export const AGENT_WORK_TABS = [
  { href: "/agent/tasks", label: "التاسكات" },
  { href: "/agent/memos", label: "التعميمات" },
  { href: "/agent/notifications", label: "الإشعارات" },
];

/** Batch 5: long or sibling pages read as tabs of one place. */
export const REPORT_TABS: Tab[] = [
  { href: "/admin/analytics", label: "التحليلات" },
  { href: "/admin/report", label: "التقرير اليومي" },
  { href: "/admin/scorecard", label: "تقييم الأجنتس" },
  { href: "/admin/campaigns", label: "مسار الحملات" },
];
export const LOG_TABS: Tab[] = [
  { href: "/admin/audit", label: "سجل التعديلات", roles: ["admin", "manager"] },
  { href: "/admin/logins", label: "سجل الدخول", roles: ["admin"] },
];
export const CONNECT_TABS: Tab[] = [
  { href: "/admin/integrations", label: "النسخ والتكاملات" },
  { href: "/admin/crm", label: "ربط الـ CRM" },
];

/** Tabs inside one page (?tab=key); the first tab is the default and drops the param. */
export async function PageTabs({ tabs, current, path }: { tabs: { key: string; label: string }[]; current: string; path: string }) {
  return <SubTabs tabs={tabs.map((x, i) => ({ href: i === 0 ? path : `${path}?tab=${x.key}`, label: x.label }))} current={tabs[0].key === current ? path : `${path}?tab=${current}`} />;
}

export const ASSIGN_TABS: Tab[] = [
  { href: "/admin/assign", label: "وزّع الليدز", roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/agents/assign", label: "الأجنت ← الشركات", roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/distribution", label: "القواعد والمهلة" },
];
