import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { weekRange } from "@/components/scorecard";
import { cairoToday } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Reads ?from=&to= (Cairo dates). Defaults to last complete week; at most one year, never past today. */
export function readRange(sp: Record<string, string | string[] | undefined>): [string, string] {
  const today = cairoToday();
  const get = (k: string) => (typeof sp[k] === "string" && DATE_RE.test(sp[k] as string) ? (sp[k] as string) : undefined);
  let from = get("from");
  let to = get("to");
  if (!from && !to) return weekRange(today, "last");
  from ??= to!;
  to ??= today;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -366)) from = addDays(to, -366);
  return [from, to];
}

function presets(today: string): [string, [string, string]][] {
  const month = today.slice(0, 8) + "01";
  const lastMonthEnd = addDays(month, -1);
  return [
    ["الأسبوع ده", weekRange(today, "current")],
    ["الأسبوع اللي فات", weekRange(today, "last")],
    ["الشهر ده", [month, today]],
    ["الشهر اللي فات", [lastMonthEnd.slice(0, 8) + "01", lastMonthEnd]],
  ];
}

/** A from/to calendar with quick presets. `keep` carries other query params (e.g. the selected agent). */
export async function RangePicker({ path, from, to, keep = {} }: { path: string; from: string; to: string; keep?: Record<string, string> }) {
  const t = await getT();
  const today = cairoToday();
  const href = ([f, tt]: [string, string]) => `${path}?${new URLSearchParams({ ...keep, from: f, to: tt })}`;
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-3">
      <form className="flex flex-wrap items-end gap-2">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="text-xs font-semibold text-zinc-500">
          {t("من")}
          <input type="date" name="from" defaultValue={from} max={today} className="input mt-1 py-2" />
        </label>
        <label className="text-xs font-semibold text-zinc-500">
          {t("إلى")}
          <input type="date" name="to" defaultValue={to} max={today} className="input mt-1 py-2" />
        </label>
        <button className="btn-primary"><CalendarRange size={16} /> {t("عرض")}</button>
      </form>
      <div className="flex flex-wrap gap-1">
        {presets(today).map(([label, r]) => {
          const on = r[0] === from && r[1] === to;
          return (
            <Link key={label} href={href(r)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
              {t(label)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
