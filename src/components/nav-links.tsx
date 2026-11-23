"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { SignOutForm } from "@/components/sign-out-form";
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
  Palmtree,
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
  leave: Palmtree,
};

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  /** Other sections that live under this item (shown as tabs on the page). */
  also?: readonly string[];
  /** Phone bottom bar: a tab (max 3) or the raised centre button; everything else lives under "More". */
  mobile?: "tab" | "fab";
  desktop?: false;
}

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(h + "/"));
}

export function SideNav({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  // The highlight slides to the current page instead of jumping.
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setPill(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [pathname]);
  return (
    <nav ref={navRef} className="relative space-y-1 overflow-y-auto px-3">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-x-3 top-0 rounded-xl bg-brand-500/12 ring-1 ring-brand-500/20 transition-transform duration-500 ease-[cubic-bezier(.34,1.4,.5,1)] motion-reduce:transition-none dark:bg-brand-500/18"
          style={{ transform: `translateY(${pill.top}px)`, height: pill.height }}
        />
      )}
      {items.filter((item) => item.desktop !== false).map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              active ? "text-brand-700 dark:text-brand-400" : "text-zinc-600 hover:bg-(--glass-strong) hover:text-(--fg)"
            }`}
          >
            <Icon size={18} className={`transition-transform group-hover:scale-110 ${active ? "text-brand-600 dark:text-brand-400" : "text-zinc-400 group-hover:text-(--fg)"}`} />
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
        style={{ viewTransitionName: "app-bottom" }}
        className="glass fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-40 flex items-center gap-1 rounded-[26px] p-1.5 shadow-[0_10px_40px_-10px_rgba(11,16,32,0.35)] backdrop-blur-xl md:hidden"
        aria-label={t("القائمة")}
      >
        {tabs.slice(0, 2).map(tab)}
        {fab && (
          <Link
            href={fab.href}
            aria-label={t(fab.label)}
            className="-mt-7 grid size-14 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-600/40 ring-4 ring-canvas transition active:scale-90"
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
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-sheet-up overflow-y-auto rounded-t-[28px] bg-canvas/95 px-4 backdrop-blur-2xl pt-2 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" />
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-linear-to-l from-brand-500 to-brand-600 p-3.5 text-white">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/20 font-bold">
                {profile.name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{profile.name}</p>
                <p className="text-xs text-white/75">{t(profile.role)}</p>
              </div>
              <SignOutForm>
                <button className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold active:scale-95">
                  <LogOut size={15} /> {t("خروج")}
                </button>
              </SignOutForm>
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
                        active ? "border-brand-500 bg-brand-50 text-brand-700" : "glass text-zinc-700"
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
            <div className="glass mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl p-2.5">
              <span className="px-1 text-xs font-bold text-zinc-500">{t("الإعدادات")}</span>
              <PrefsControls theme={theme} sound />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
