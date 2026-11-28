import Link from "next/link";
import { Ban, DatabaseBackup, History, KeyRound, MapPin, MessageSquareText, PlugZap, ShieldCheck, UserCog, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { requireRole, VIEWERS } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { settingsFor } from "@/lib/settings-pages";

const ICONS: Record<string, LucideIcon> = {
  templates: MessageSquareText, ban: Ban, location: MapPin, requests: ShieldCheck, audit: History,
  logins: KeyRound, crm: PlugZap, backup: DatabaseBackup, account: UserCog,
};

/** Setup pages in one place, so the main menu keeps only daily work. */
export default async function SettingsPage() {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  const pages = settingsFor(me.role).filter((p) => !p.tabOf); // the second page of a pair opens as a tab
  return (
    <>
      <PageHeader title={t("كل الإعدادات")} subtitle={t("الحاجات اللي بتتظبط مرة وتتساب")} />
      <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((p) => {
          const Icon = ICONS[p.icon] ?? UserCog;
          return (
            <li key={p.href}>
              <Link href={p.href} className="card flex h-full items-center gap-4 transition hover:-translate-y-0.5 hover:border-brand-200">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Icon size={20} /></span>
                <span className="min-w-0">
                  <span className="block font-bold">{t(p.label)}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">{t(p.hint)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
