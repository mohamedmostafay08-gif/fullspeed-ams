"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { SignOutForm } from "@/components/sign-out-form";
import { PrefsControls } from "@/components/prefs";
import { Activity, Ban, BarChart3, Bell, Building2, CalendarCheck, CheckSquare, ChevronDown, Coffee, DatabaseBackup, FileText, Gift, History, Inbox, KeyRound, LayoutDashboard, LayoutGrid, ListTodo, LogOut, MapPin, Megaphone, MessageCircle, MessageSquareText, Network, Palmtree, PanelRightClose, PanelRightOpen, PhoneCall, PlugZap, PlusCircle, Settings, ShieldCheck, Sun, TrendingUp, UserCog, UserRound, Users, type LucideIcon } from "lucide-react";

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
  today: Sun,
  queue: ListTodo,
  approvals: Inbox,
  templates: MessageSquareText,
  settings: Settings,
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
  /** Menu section this item sits under (items of one group are listed together, in order). */
  group?: string;
  /** Count shown next to the item, e.g. pending approvals. */
  badge?: number;
}

/** Sections that start folded unless the current page is inside them. */
const FOLDED_GROUPS = new Set<string>();

function groupsOf(items: NavItem[]) {
  const out: { name: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const name = item.group ?? "";
    const last = out[out.length - 1];
    if (last && last.name === name) last.items.push(item);
    else out.push({ name, items: [item] });
  }
  return out;
}

function Count({ n, className = "" }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={`num grid h-5 min-w-5 place-items-center rounded-full bg-(--fg) px-1.5 text-[11px] font-extrabold text-(--surface) ${className}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

const RAIL_COOKIE = "nav";

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(h + "/"));
}

export function SideNav({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = groupsOf(items.filter((item) => item.desktop !== false));
  // The highlight slides to the current page instead of jumping.
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setPill(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [pathname, open]);

  return (
    <nav ref={navRef} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-x-3 top-0 rounded-xl bg-zinc-100 ring-1 ring-zinc-200/70 transition-transform duration-500 ease-[cubic-bezier(.34,1.4,.5,1)] motion-reduce:transition-none"
          style={{ transform: `translateY(${pill.top}px)`, height: pill.height }}
        />
      )}
      {groups.map((g) => {
        const foldable = FOLDED_GROUPS.has(g.name);
        const hasActive = g.items.some((i) => isActive(pathname, i));
        const expanded = !foldable || (open[g.name] ?? hasActive);
        return (
          <div key={g.name || "_"} className="space-y-0.5">
            {g.name &&
              (foldable ? (
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [g.name]: !expanded }))}
                  aria-expanded={expanded}
                  title={t(g.name)}
                  className="nav-fold flex w-full items-center justify-between rounded-lg px-3 pt-1 pb-0.5 text-[11px] font-bold tracking-wide text-zinc-400 hover:text-zinc-600"
                >
                  <span className="nav-text">{t(g.name)}</span>
                  <ChevronDown size={14} className={`transition-transform ${expanded ? "" : "ltr:-rotate-90 rtl:rotate-90"}`} />
                </button>
              ) : (
                <p className="nav-text px-3 pt-1 pb-0.5 text-[11px] font-bold tracking-wide text-zinc-400">{t(g.name)}</p>
              ))}
            {expanded &&
              g.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={t(item.label)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      active ? "text-(--fg)" : "text-zinc-600 hover:bg-(--glass-strong) hover:text-(--fg)"
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon size={18} className={`transition-transform group-hover:scale-110 ${active ? "text-(--fg)" : "text-zinc-400 group-hover:text-(--fg)"}`} />
                      {!!item.badge && <span className="nav-dot absolute -top-1 -end-1 hidden size-2 rounded-full bg-(--fg)" />}
                    </span>
                    <span className="nav-text min-w-0 flex-1 truncate">{t(item.label)}</span>
                    <Count n={item.badge} className="nav-text" />
                  </Link>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

/** Folds the desktop sidebar to icons only, and remembers the choice. */
export function RailToggle({ initial }: { initial: boolean }) {
  const t = useT();
  const [rail, setRail] = useState(initial);
  const toggle = () => {
    const next = !rail;
    setRail(next);
    document.querySelector(".app-side")?.toggleAttribute("data-rail", next);
    document.cookie = `${RAIL_COOKIE}=${next ? "rail" : "full"}; path=/; max-age=31536000; samesite=lax`;
  };
  const Icon = rail ? PanelRightOpen : PanelRightClose;
  return (
    <button type="button" onClick={toggle} className="rounded-lg p-2 text-zinc-400 transition hover:bg-(--glass-strong) hover:text-(--fg)" aria-label={t(rail ? "كبّر القايمة" : "صغّر القايمة")} title={t(rail ? "كبّر القايمة" : "صغّر القايمة")}>
      <Icon size={17} className="ltr:-scale-x-100" />
    </button>
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
        className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-bold transition active:scale-95 ${active ? "text-(--fg)" : "text-zinc-500"}`}
      >
        <span className={`relative grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-zinc-100" : ""}`}>
          <Icon size={20} strokeWidth={active ? 2.4 : 2} />
          <Count n={item.badge} className="absolute -top-1.5 end-0 h-4 min-w-4 px-1 text-[9.5px]" />
        </span>
        <span className="max-w-full truncate px-0.5">{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <>
      <nav
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
            {(() => {
              const FabIcon = fab.icon === "add" ? PlusCircle : (ICONS[fab.icon] ?? PlusCircle);
              return <FabIcon size={26} />;
            })()}
          </Link>
        )}
        {tabs.slice(2).map(tab)}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-bold transition active:scale-95 ${moreActive ? "text-(--fg)" : "text-zinc-500"}`}
        >
          <span className={`relative grid h-7 w-12 place-items-center rounded-full ${moreActive ? "bg-zinc-100" : ""}`}>
            <LayoutGrid size={20} />
            {rest.some((i) => i.badge) && <span className="absolute top-0 end-2 size-2 rounded-full bg-(--fg)" />}
          </span>
          {t("المزيد")}
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t("المزيد")}>
          <button className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]" aria-label={t("إغلاق")} onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-sheet-up overflow-y-auto rounded-t-[28px] bg-canvas/95 px-4 backdrop-blur-2xl pt-2 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300" />
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-zinc-100 p-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--fg) font-bold text-(--surface)">
                {profile.name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{profile.name}</p>
                <p className="text-xs text-zinc-500">{t(profile.role)}</p>
              </div>
              <SignOutForm>
                <button className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-rose-600 active:scale-95">
                  <LogOut size={15} /> {t("خروج")}
                </button>
              </SignOutForm>
            </div>
            <div className="space-y-4">
              {groupsOf(rest).map((g) => (
                <section key={g.name || "_"}>
                  {g.name && <p className="mb-2 px-1 text-xs font-bold text-zinc-500">{t(g.name)}</p>}
                  <ul className="stagger grid grid-cols-3 gap-2.5">
                    {g.items.map((item) => {
                      const Icon = ICONS[item.icon] ?? LayoutDashboard;
                      const active = isActive(pathname, item);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`relative flex h-full flex-col items-center gap-2 rounded-2xl border p-3 text-center text-xs font-bold transition active:scale-95 ${
                              active ? "border-(--fg) bg-zinc-100 text-(--fg)" : "glass text-zinc-700"
                            }`}
                          >
                            <Count n={item.badge} className="absolute top-2 end-2" />
                            <span className={`grid size-10 place-items-center rounded-xl ${active ? "bg-(--fg) text-(--surface)" : "bg-zinc-100 text-zinc-600"}`}>
                              <Icon size={20} />
                            </span>
                            <span className="leading-tight">{t(item.label)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
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

/** Where you are, in the desktop header: «الليدز › ليدز للتوزيع», plus «تفاصيل» on a page inside it. */
export function Breadcrumb({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  const match = items
    .filter((i) => i.desktop !== false && isActive(pathname, i))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!match) return null;
  const deeper = pathname !== match.href && !(match.also ?? []).includes(pathname) && pathname.startsWith(match.href + "/");
  return (
    <nav aria-label={t("مكانك")} className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
      {match.group && <span className="truncate text-zinc-400">{t(match.group)}</span>}
      {match.group && <ChevronDown size={14} className="shrink-0 text-zinc-300 ltr:-rotate-90 rtl:rotate-90" />}
      {deeper ? (
        <>
          <Link href={match.href} className="truncate font-semibold text-zinc-500 hover:text-(--fg)">{t(match.label)}</Link>
          <ChevronDown size={14} className="shrink-0 text-zinc-300 ltr:-rotate-90 rtl:rotate-90" />
          <span className="truncate font-semibold">{t("تفاصيل")}</span>
        </>
      ) : (
        <span className="truncate font-semibold">{t(match.label)}</span>
      )}
    </nav>
  );
}
