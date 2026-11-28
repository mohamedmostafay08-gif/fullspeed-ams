import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getT } from "@/lib/i18n/server";

type CalLeave = { user_id: string; start_date: string; end_date: string; status: "pending" | "approved"; name: string; team_id: string | null };

const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
// Egyptian week starts on Saturday; ISO weekday numbers for the header.
const WEEK = [[6, "سبت"], [7, "حد"], [1, "اتنين"], [2, "تلات"], [3, "أربع"], [4, "خميس"], [5, "جمعة"]] as const;
const isoDow = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * A month of who's off. A day turns red when more than half of any one team is out (approved or waiting).
 */
export async function LeaveCalendar({
  month, today, leaves, holidays, offDays, teamSize, path,
}: {
  month: string; today: string; leaves: CalLeave[]; holidays: Record<string, string>; offDays: number[];
  teamSize: Record<string, number>; path: string;
}) {
  const t = await getT();
  const first = `${month}-01`;
  const last = addDays(shiftMonth(month, 1) + "-01", -1);
  const lead = (isoDow(first) + 1) % 7; // empty cells before the 1st (Saturday = 0)
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title mb-0"><CalendarDays size={18} className="text-brand-600" /> {t("تقويم الإجازات")}</h2>
        <div className="flex items-center gap-1">
          <Link href={`${path}?month=${shiftMonth(month, -1)}`} className="btn-ghost btn-sm" aria-label={t("الشهر اللي فات")}><ChevronRight size={16} /></Link>
          <span className="num min-w-24 text-center font-semibold">{month}</span>
          <Link href={`${path}?month=${shiftMonth(month, 1)}`} className="btn-ghost btn-sm" aria-label={t("الشهر الجاي")}><ChevronLeft size={16} /></Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-1 text-xs">
          {WEEK.map(([, label]) => <div key={label} className="py-1 text-center font-semibold text-zinc-500">{t(label)}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {days.map((d) => {
            const off = leaves.filter((l) => d >= l.start_date && d <= l.end_date);
            const holiday = holidays[d];
            const weekly = offDays.includes(isoDow(d));
            const perTeam = new Map<string, number>();
            for (const l of off) if (l.team_id) perTeam.set(l.team_id, (perTeam.get(l.team_id) ?? 0) + 1);
            const crowded = !holiday && !weekly && [...perTeam].some(([team, n]) => (teamSize[team] ?? 0) > 1 && n * 2 > teamSize[team]);
            return (
              <div
                key={d}
                className={`min-h-20 rounded-lg border p-1.5 ${crowded ? "border-rose-300 bg-rose-50" : holiday || weekly ? "border-transparent bg-zinc-100" : "border-zinc-200"} ${d === today ? "ring-2 ring-brand-500" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="num font-semibold">{Number(d.slice(8))}</span>
                  {crowded && <span className="font-bold text-rose-600" title={t("أكتر من نص التيم إجازة")}>⚠️</span>}
                </div>
                {holiday && <p className="mt-1 truncate font-semibold text-emerald-700" title={holiday}>🎉 {holiday}</p>}
                <ul className="mt-1 space-y-0.5">
                  {off.slice(0, 4).map((l) => (
                    <li
                      key={l.user_id + l.start_date}
                      className={`truncate rounded px-1 ${l.status === "approved" ? "bg-sky-100 text-sky-900" : "border border-dashed border-amber-400 text-amber-800"}`}
                      title={l.name}
                    >
                      {l.name.split(" ")[0]}
                    </li>
                  ))}
                  {off.length > 4 && <li className="text-zinc-500">+{off.length - 4}</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sky-200" /> {t("إجازة متوافق عليها")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-amber-400" /> {t("مستنية الرد")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-rose-200" /> {t("أكتر من نص التيم إجازة")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-zinc-200" /> {t("إجازة رسمية أو أسبوعية")}</span>
      </div>
    </section>
  );
}
