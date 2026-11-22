"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { signOut } from "@/app/actions/auth";
import { PrefsControls } from "@/components/prefs";
import {
  Activity,
  Ban,
  BarChart3,
  FileText,
  History,
  MessageCircle,
  PhoneCall,
  Bell,
  CalendarCheck,
  Coffee,
  KeyRound,
  Network,
  Megaphone,
  ShieldCheck,
  TrendingUp,
  MapPin,
  Building2,
  CheckSquare,
  Gift,
  LayoutDashboard,
  LayoutGrid,
  DatabaseBackup,
  UserCog,
  LogOut,
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
  analytics: BarChart3,
  coffee: Coffee,
  location: MapPin,
  phone: PhoneCall,
  whatsapp: MessageCircle,
  ban: Ban,
  account: UserCog,
  backup: DatabaseBackup,
  live: Activity,
  report: FileText,
  audit: History,
  attendance: CalendarCheck,
  scorecard: TrendingUp,
  memo: Megaphone,
  requests: ShieldCheck,
  logins: KeyRound,
  teams: Network,
};

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  /** Phone bottom bar: a tab (max 3) or the raised centre button; everything else lives under "More". */
  mobile?: "tab" | "fab";
  desktop?: false;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

export function SideNav({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav className="space-y-1 px-3">
      {items.filter((item) => item.desktop !== false).map((item) => {
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
            {active && <span className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-brand-500" />}
            <Icon size={18} className={active ? "text-brand-400" : "text-slate-ink group-hover:text-bone"} />
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items, profile, theme }: { items: NavItem[]; profile: { name: string; role: string }; theme: "system" | "light" | "dark" }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = items.filter((i) => i.mobile === "tab").slice(0, 3);
  const fab = items.find((i) => i.mobile === "fab");
  const rest = items.filter((i) => !tabs.includes(i) && i !== fab);
  const moreActive = rest.some((i) => isActive(pathname, i));
  // Close the sheet whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [open]);

  const tab = (item: NavItem) => {
    const Icon = ICONS[item.icon] ?? LayoutDashboard;
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-bold transition active:scale-95 ${active ? "text-brand-600" : "text-zinc-500"}`}
      >
        <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-brand-50" : ""}`}>
          <Icon size={20} strokeWidth={active ? 2.4 : 2} />
        </span>
        <span className="max-w-full truncate px-0.5">{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <>
      <nav
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-40 flex items-center gap-1 rounded-[26px] border border-zinc-200/80 bg-white/90 p-1.5 shadow-[0_10px_40px_-10px_rgba(11,16,32,0.35)] backdrop-blur-xl md:hidden"
        aria-label={t("القائمة")}
      >
        {tabs.slice(0, 2).map(tab)}
        {fab && (
          <Link
            href={fab.href}
            aria-label={t(fab.label)}
            className="-mt-7 grid size-14 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/40 ring-4 ring-canvas transition active:scale-90"
          >
            <PlusCircle size={26} />
          </Link>
        )}
        {tabs.slice(2).map(tab)}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-bold transition active:scale-95 ${moreActive ? "text-brand-600" : "text-zinc-500"}`}
        >
          <span className={`grid h-7 w-12 place-items-center rounded-full ${moreActive ? "bg-brand-50" : ""}`}>
            <LayoutGrid size={20} />
          </span>
          {t("المزيد")}
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t("المزيد")}>
          <button className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]" aria-label={t("إغلاق")} onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-sheet-up overflow-y-auto rounded-t-[28px] bg-canvas px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" />
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-ink p-3.5 text-white">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600 font-bold">
                {profile.name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{profile.name}</p>
                <p className="text-xs text-slate-ink">{t(profile.role)}</p>
              </div>
              <form action={signOut}>
                <button className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold active:scale-95">
                  <LogOut size={15} /> {t("خروج")}
                </button>
              </form>
            </div>
            <ul className="stagger grid grid-cols-3 gap-2.5">
              {rest.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = isActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex h-full flex-col items-center gap-2 rounded-2xl border p-3 text-center text-xs font-bold transition active:scale-95 ${
                        active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                    >
                      <span className={`grid size-10 place-items-center rounded-xl ${active ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600"}`}>
                        <Icon size={20} />
                      </span>
                      <span className="leading-tight">{t(item.label)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-white p-2.5">
              <span className="px-1 text-xs font-bold text-zinc-500">{t("الإعدادات")}</span>
              <PrefsControls theme={theme} sound />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
