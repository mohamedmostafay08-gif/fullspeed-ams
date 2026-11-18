"use client";

import { useEffect, useRef, useState } from "react";
import { Flame, Maximize, PartyPopper } from "lucide-react";
import { CompanyLogo } from "@/components/ui";
import { CountUp } from "@/components/count-up";
import { BrandMark } from "@/components/brand-mark";
import { celebrate, playSound } from "@/lib/fx";
import { useLocale, useT } from "@/lib/i18n/client";
import { cairoTime } from "@/lib/time";
import type { BoardRow } from "@/lib/badges";

export type TvData = {
  day: string;
  board: BoardRow[];
  companies: { name: string; logo: string | null; leads: number; hired: number }[];
  hires: { id: string; lead: string; at: string; company: string; logo: string | null; agent: string }[];
  totals: { leads: number; calls: number; interviews: number; hired: number };
};

const PANELS = ["board", "companies", "hires"] as const;
const ROTATE_MS = 15_000;
const MEDAL = ["🥇", "🥈", "🥉"];

export function TvBoard({ data }: { data: TvData }) {
  const t = useT();
  const locale = useLocale();
  const [panel, setPanel] = useState(0);
  const [clock, setClock] = useState("");
  const [party, setParty] = useState<TvData["hires"][number] | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" }).format(new Date()));
    tick();
    const a = setInterval(tick, 10_000);
    const b = setInterval(() => setPanel((p) => (p + 1) % PANELS.length), ROTATE_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [locale]);

  // A hire that wasn't there on the previous render → full-screen celebration.
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(data.hires.map((h) => h.id));
      return;
    }
    const fresh = data.hires.find((h) => !seen.current!.has(h.id));
    data.hires.forEach((h) => seen.current!.add(h.id));
    if (!fresh) return;
    const show = setTimeout(() => {
      setParty(fresh);
      celebrate();
      playSound("target");
    }, 0);
    const hide = setTimeout(() => setParty(null), 8000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [data.hires]);

  const top = data.board.slice(0, 10);
  const max = Math.max(1, ...top.map((r) => r.points));

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-2xl font-extrabold">Full Speed</p>
            <p className="text-sm text-slate-ink">{t("فريق الأكوزيشن")} · {data.day}</p>
          </div>
        </div>
        <div className="ms-auto grid grid-cols-4 gap-3">
          {([
            ["ليدز", data.totals.leads, "text-sky-300"],
            ["مكالمات", data.totals.calls, "text-violet-300"],
            ["مقابلات", data.totals.interviews, "text-amber-300"],
            ["اشتغلوا", data.totals.hired, "text-emerald-300"],
          ] as const).map(([label, v, cls]) => (
            <div key={label} className="rounded-2xl bg-white/5 px-5 py-3 text-center ring-1 ring-white/10">
              <p className={`num text-4xl font-bold ${cls}`}><CountUp value={v} /></p>
              <p className="text-sm text-slate-ink">{t(label)}</p>
            </div>
          ))}
        </div>
        <p className="num text-5xl font-bold tabular-nums">{clock}</p>
        <button
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="rounded-xl p-3 text-slate-ink ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
          aria-label={t("ملء الشاشة")}
          title={t("ملء الشاشة")}
        >
          <Maximize size={22} />
        </button>
      </header>

      <div className="flex gap-2" aria-hidden>
        {PANELS.map((p, i) => (
          <span key={p} className={`h-1.5 flex-1 overflow-hidden rounded-full bg-white/10`}>
            {i === panel && <span key={panel} className="block h-full origin-left bg-brand-500 [animation:tv-progress_15s_linear_both] rtl:origin-right" />}
          </span>
        ))}
      </div>

      <section key={panel} className="flex-1 animate-slide-in">
        {PANELS[panel] === "board" && (
          <>
            <h2 className="mb-5 text-3xl font-extrabold">🏆 {t("ترتيب النهارده")}</h2>
            <ol className="grid gap-3 xl:grid-cols-2">
              {top.map((r, i) => (
                <li key={r.agent_id} className="relative overflow-hidden rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="absolute inset-y-0 start-0 bg-brand-500/20" style={{ width: `${(r.points / max) * 100}%` }} />
                  <div className="relative flex items-center gap-4">
                    <span className="w-12 text-center text-4xl">{MEDAL[i] ?? <span className="num text-2xl text-slate-ink">{i + 1}</span>}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-2xl font-bold">{r.full_name}</p>
                      <p className="text-sm text-slate-ink">{t("{0} ليد · {1} مكالمة · {2} اشتغلوا", r.leads, r.calls, r.hired)}</p>
                    </div>
                    {r.streak > 1 && <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-3 py-1 text-lg font-bold text-orange-300"><Flame size={18} /> {r.streak}</span>}
                    <span className="num text-4xl font-bold">{r.points}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {PANELS[panel] === "companies" && (
          <>
            <h2 className="mb-5 text-3xl font-extrabold">🏢 {t("الشركات النهارده")}</h2>
            {data.companies.length === 0 ? (
              <p className="text-xl text-slate-ink">{t("لسه مفيش ليدز النهارده")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                {data.companies.map((c) => (
                  <li key={c.name} className="flex items-center gap-4 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                    <CompanyLogo name={c.name} src={c.logo} size={64} />
                    <div>
                      <p className="text-xl font-bold">{c.name}</p>
                      <p className="mt-1 text-lg">
                        <span className="num text-sky-300">{c.leads}</span> <span className="text-slate-ink">{t("ليد")}</span> ·{" "}
                        <span className="num text-emerald-300">{c.hired}</span> <span className="text-slate-ink">{t("اشتغلوا")}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {PANELS[panel] === "hires" && (
          <>
            <h2 className="mb-5 text-3xl font-extrabold">🎉 {t("تعيينات النهارده")}</h2>
            {data.hires.length === 0 ? (
              <p className="text-xl text-slate-ink">{t("أول تعيين النهارده هيظهر هنا")}</p>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {data.hires.slice(0, 12).map((h) => (
                  <li key={h.id} className="flex items-center gap-4 rounded-2xl bg-emerald-500/10 p-4 ring-1 ring-emerald-400/20">
                    <CompanyLogo name={h.company} src={h.logo} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xl font-bold">{h.lead}</p>
                      <p className="text-sm text-slate-ink">{h.company} · {t("بواسطة")} {h.agent}</p>
                    </div>
                    <span className="num text-lg text-emerald-300">{cairoTime(h.at, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {party && (
        <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/70 backdrop-blur-sm">
          <div className="animate-zoom-in rounded-[2rem] bg-gradient-to-b from-emerald-500 to-emerald-700 px-16 py-12 text-center shadow-2xl">
            <PartyPopper size={72} className="mx-auto animate-bounce-in" />
            <p className="mt-4 text-2xl font-bold text-white/85">{t("تعيين جديد!")}</p>
            <p className="mt-2 text-6xl font-extrabold">{party.agent}</p>
            <p className="mt-3 text-2xl">{party.lead} · {party.company}</p>
          </div>
        </div>
      )}
    </main>
  );
}
