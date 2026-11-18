import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { BottomNav, SideNav, type NavItem } from "@/components/nav-links";
import { NotificationBell } from "@/components/notification-bell";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { PrefsControls } from "@/components/prefs";
import { getT, getTheme } from "@/lib/i18n/server";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export async function AppShell({
  profile,
  nav,
  unread,
  notificationsHref,
  children,
}: {
  profile: Profile;
  nav: NavItem[];
  unread: number;
  notificationsHref: string;
  children: React.ReactNode;
}) {
  const [t, theme] = await Promise.all([getT(), getTheme()]);
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden bg-ink md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col">
        <div className="flex items-center gap-3 px-5 pt-6 pb-8">
          <BrandMark />
          <div className="leading-tight">
            <p className="font-extrabold tracking-tight text-white">Full Speed</p>
            <p className="text-[11px] font-medium text-slate-ink">Acquisition</p>
          </div>
        </div>
        <SideNav items={nav} />
        <div className="mt-auto p-3">
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{initials(profile.full_name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{profile.full_name}</p>
              <p className="text-[11px] text-slate-ink">{t(ROLE_LABELS[profile.role])}</p>
            </div>
            <form action={signOut}>
              <button className="rounded-lg p-2 text-slate-ink transition hover:bg-white/10 hover:text-white" aria-label={t("خروج")} title={t("خروج")}>
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-20 md:pb-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200/80 bg-white/85 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <BrandMark small />
            <span className="text-sm font-extrabold">Full Speed</span>
          </div>
          <div className="ms-auto flex items-center gap-1">
            <PrefsControls theme={theme} sound />
            <NotificationBell userId={profile.id} initial={unread} href={notificationsHref} />
            <form action={signOut} className="md:hidden">
              <button className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100" aria-label={t("خروج")}>
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </header>
        <main className="w-full animate-rise px-4 py-6 md:px-8 md:py-8 2xl:px-10">{children}</main>
      </div>

      <BottomNav items={nav} />
    </div>
  );
}

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`grid place-items-center rounded-xl bg-brand-600 text-white ${small ? "size-8" : "size-10"}`}>
      <svg viewBox="0 0 24 24" className={small ? "size-4" : "size-5"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M4 17c4-1 6-3 7-6s3-5 9-6" />
        <circle cx="20" cy="5" r="1.6" fill="currentColor" stroke="none" />
        <path d="M3 21h7" opacity=".55" />
      </svg>
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
