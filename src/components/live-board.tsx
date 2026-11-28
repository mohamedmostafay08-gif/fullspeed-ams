"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Coffee, Flame, Moon, Phone, Wifi } from "lucide-react";
import { joinPresence } from "@/lib/supabase/client";
import { useLocale, useT } from "@/lib/i18n/client";
import { cairoTime } from "@/lib/time";

export type LiveAgent = {
  id: string;
  name: string;
  team: string | null;
  points: number;
  leads: number;
  calls: number;
  hired: number;
  streak: number;
  lastAt: string | null;
  lastNote: string | null;
  breakEndsAt: string | null;
  breakPending: boolean;
  waiting: number;
  slow: number;
  talkMin: number;
};

type State = "break" | "active" | "idle" | "away" | "off";
const IDLE_MIN = 30;

const STYLE: Record<State, { label: string; cls: string; dot: string }> = {
  break: { label: "في البريك", cls: "bg-teal-50 text-teal-800", dot: "bg-teal-500" },
  active: { label: "شغال", cls: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500 animate-pulse" },
  idle: { label: "فاتح ومفيش نشاط", cls: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  away: { label: "مش متصل", cls: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400" },
  off: { label: "مدخلش النهارده", cls: "bg-zinc-100 text-zinc-500", dot: "bg-zinc-300" },
};

export function LiveBoard({ agents, base }: { agents: LiveAgent[]; base: string }) {
  const t = useT();
  const locale = useLocale();
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => joinPresence(`watch-${Math.random().toString(36).slice(2)}`, null, (ids) => setOnline(ids)), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const stateOf = (a: LiveAgent): State => {
      if (a.breakEndsAt && new Date(a.breakEndsAt).getTime() > now) return "break";
      const since = a.lastAt ? (now - new Date(a.lastAt).getTime()) / 60_000 : Infinity;
      if (online.has(a.id)) return since <= IDLE_MIN ? "active" : "idle";
      return a.lastAt ? "away" : "off";
    };
    // Stuck first: open but idle, or sitting on leads waiting 30+ minutes. Then working, break, away, off.
    const order: Record<State, number> = { idle: 1, active: 2, break: 3, away: 4, off: 5 };
    const rank = (a: LiveAgent & { state: State }) => (a.state === "idle" || (a.slow > 0 && a.state !== "off") ? 0 : order[a.state]);
    return agents
      .map((a) => ({ ...a, state: stateOf(a) }))
      .sort((x, y) => rank(x) - rank(y) || (rank(x) === 0 ? y.slow - x.slow : 0) || order[x.state] - order[y.state] || y.points - x.points);
  }, [agents, online, now]);

  const count = (s: State) => rows.filter((r) => r.state === s).length;
  const minutes = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));

  return (
    <div className="space-y-5">
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          ["active", Wifi],
          ["idle", AlertTriangle],
          ["break", Coffee],
          ["away", Moon],
          ["off", Moon],
        ] as const).map(([s, Icon]) => (
          <div key={s} className={`card flex items-center gap-3 p-4 ${STYLE[s].cls}`}>
            <Icon size={20} />
            <div>
              <p className="num text-2xl font-bold">{count(s)}</p>
              <p className="text-xs font-semibold">{t(STYLE[s].label)}</p>
            </div>
          </div>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map((a) => (
          <li key={a.id} className={`card lift flex flex-col gap-3 p-4 ${a.state === "idle" || (a.slow > 0 && a.state !== "off") ? "ring-2 ring-rose-200" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-white">
                {a.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("")}
                <span className={`absolute -end-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-white ${STYLE[a.state].dot}`} />
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`${base}/agents/${a.id}`} className="block truncate font-bold hover:text-brand-700">{a.name}</Link>
                <p className="truncate text-xs text-zinc-500">{a.team ?? "—"}</p>
              </div>
              {a.streak > 1 && <span className="badge bg-orange-100 text-orange-700"><Flame size={12} /> {a.streak}</span>}
            </div>

            <p className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${STYLE[a.state].cls}`}>
              {t(STYLE[a.state].label)}
              {a.state === "break" && a.breakEndsAt && ` · ${t("فاضل {0} د", Math.max(0, Math.round((new Date(a.breakEndsAt).getTime() - now) / 60_000)))}`}
              {(a.state === "idle" || a.state === "away") && a.lastAt && ` · ${t("آخر حركة من {0} د", minutes(a.lastAt))}`}
              {a.breakPending && ` · ${t("طالب بريك")}`}
            </p>

            <dl className="grid grid-cols-4 gap-1 text-center">
              {[
                ["نقط", a.points],
                ["ليدز", a.leads],
                ["مكالمات", a.calls],
                ["اشتغلوا", a.hired],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-zinc-50 py-1.5">
                  <dd className="num text-lg font-bold">{v}</dd>
                  <dt className="text-[10px] text-zinc-500">{t(l as string)}</dt>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {a.waiting > 0 && <span className="badge bg-sky-50 text-sky-800"><Phone size={11} /> {t("{0} مستنيين مكالمة", a.waiting)}</span>}
              {a.slow > 0 && <span className="badge bg-rose-50 text-rose-700"><AlertTriangle size={11} /> {t("{0} متأخرين +30 د", a.slow)}</span>}
              {a.talkMin > 0 && <span className="badge bg-emerald-50 text-emerald-800"><Phone size={11} /> {t("{0} د كلام", a.talkMin)}</span>}
              {a.lastAt && <span className="ms-auto text-zinc-400">{cairoTime(a.lastAt, locale)} · {a.lastNote ? t(a.lastNote) : "—"}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
