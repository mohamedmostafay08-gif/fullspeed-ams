import Link from "next/link";
import { getT } from "@/lib/i18n/server";

/** Tabs that join two related pages under one menu item. */
export async function SubTabs({ tabs, current }: { tabs: { href: string; label: string }[]; current: string }) {
  const t = await getT();
  return (
    <div className="mb-4 flex w-fit gap-1 rounded-xl bg-zinc-100 p-1">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab.href === current ? "bg-white shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
          {t(tab.label)}
        </Link>
      ))}
    </div>
  );
}

export const ATTENDANCE_TABS = [
  { href: "/admin/attendance", label: "الحضور والانصراف" },
  { href: "/admin/breaks", label: "البريكات" },
];
export const ADMIN_WORK_TABS = [
  { href: "/admin/tasks", label: "التاسكات" },
  { href: "/admin/memos", label: "التعميمات" },
];
export const AGENT_WORK_TABS = [
  { href: "/agent/tasks", label: "التاسكات" },
  { href: "/agent/memos", label: "التعميمات" },
];
