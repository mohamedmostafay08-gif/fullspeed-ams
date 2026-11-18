import { LogOut, Zap } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { NotificationBell } from "@/components/notification-bell";
import { ROLE_LABELS, type Profile } from "@/lib/types";

export function AppShell({
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
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-ink text-zinc-300 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0">
        <div className="flex items-center gap-2 p-4 text-white">
          <span className="rounded-lg bg-brand-600 p-1.5">
            <Zap size={18} />
          </span>
          <span className="font-bold">Full Speed</span>
        </div>
        <NavLinks items={nav} />
        <div className="hidden border-t border-white/10 p-4 md:absolute md:bottom-0 md:block md:w-60">
          <p className="truncate text-sm font-semibold text-white">{profile.full_name}</p>
          <p className="text-xs text-zinc-400">{ROLE_LABELS[profile.role]}</p>
          <form action={signOut} className="mt-3">
            <button className="flex items-center gap-2 text-xs text-zinc-400 hover:text-white">
              <LogOut size={14} /> خروج
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 md:justify-end md:px-6 md:py-3">
          <span className="text-sm font-semibold md:hidden">{profile.full_name}</span>
          <NotificationBell userId={profile.id} initial={unread} href={notificationsHref} />
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
        <form action={signOut} className="p-4 md:hidden">
          <button className="btn-ghost w-full">
            <LogOut size={14} /> خروج
          </button>
        </form>
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="h-14 bg-ink md:h-screen md:w-60" />
      <div className="flex-1 animate-pulse space-y-4 p-6">
        <div className="h-8 w-48 rounded-lg bg-zinc-200" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-zinc-200" />)}
        </div>
        <div className="h-64 rounded-2xl bg-zinc-200" />
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
