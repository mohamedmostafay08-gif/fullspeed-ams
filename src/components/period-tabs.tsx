import Link from "next/link";
import { PERIODS, type Period } from "@/lib/teams";
import { getT } from "@/lib/i18n/server";

export async function PeriodTabs({ current, href }: { current: Period; href: (p: Period) => string }) {
  const t = await getT();
  return (
    <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
      {PERIODS.map(([p, label]) => (
        <Link key={p} href={href(p)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${p === current ? "bg-white shadow-sm" : "text-zinc-500"}`}>
          {t(label)}
        </Link>
      ))}
    </div>
  );
}
