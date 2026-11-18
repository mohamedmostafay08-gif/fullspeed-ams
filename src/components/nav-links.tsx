"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  CheckSquare,
  Gift,
  LayoutDashboard,
  PlugZap,
  PlusCircle,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: UserRound,
  team: Users,
  companies: Building2,
  tasks: CheckSquare,
  bonus: Gift,
  crm: PlugZap,
  add: PlusCircle,
  bell: Bell,
};

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1 px-3">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              active ? "bg-white/10 text-white" : "text-slate-ink hover:bg-white/5 hover:text-bone"
            }`}
          >
            {active && <span className="absolute inset-y-2 right-0 w-1 rounded-l-full bg-brand-500" />}
            <Icon size={18} className={active ? "text-brand-400" : "text-slate-ink group-hover:text-bone"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.slice(0, 5).map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active ? "text-brand-600" : "text-zinc-500"}`}
          >
            <Icon size={20} />
            <span className="max-w-full truncate px-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
