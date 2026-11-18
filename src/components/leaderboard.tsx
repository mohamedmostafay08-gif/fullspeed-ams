import { Flame, Trophy } from "lucide-react";
import { Empty } from "@/components/ui";
import { CountUp } from "@/components/count-up";
import { getT } from "@/lib/i18n/server";
import type { Badge, BoardRow } from "@/lib/badges";

const MEDAL = ["🥇", "🥈", "🥉"];

/** Today's ranking; highlights `me` and always shows my row even outside the top N. */
export async function Leaderboard({ rows, me, top = 5 }: { rows: BoardRow[]; me?: string; top?: number }) {
  const t = await getT();
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const shown = ranked.slice(0, top);
  const mine = ranked.find((r) => r.agent_id === me);
  if (mine && mine.rank > top) shown.push(mine);
  const max = Math.max(1, ...ranked.map((r) => r.points));

  return (
    <section className="card">
      <h2 className="card-title"><Trophy size={18} className="text-amber-500" /> {t("ترتيب النهارده")}</h2>
      {ranked.every((r) => r.points === 0) ? (
        <Empty icon={Trophy}>{t("لسه محدش جمع نقط النهارده — ابدأ إنت!")}</Empty>
      ) : (
        <ol className="space-y-2">
          {shown.map((r) => (
            <li
              key={r.agent_id}
              className={`relative overflow-hidden rounded-xl border p-2.5 ${r.agent_id === me ? "border-brand-500 bg-brand-50/60" : "border-zinc-200"}`}
            >
              <div className="absolute inset-y-0 start-0 bg-brand-500/10 transition-[width] duration-700" style={{ width: `${(r.points / max) * 100}%` }} />
              <div className="relative flex items-center gap-3">
                <span className="w-7 text-center text-lg">{MEDAL[r.rank - 1] ?? <span className="num text-sm text-zinc-500">{r.rank}</span>}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {r.full_name} {r.agent_id === me && <span className="text-xs font-semibold text-brand-700">({t("إنت")})</span>}
                  </p>
                  <p className="text-[11px] text-zinc-500">{t("{0} ليد · {1} مكالمة · {2} اشتغلوا", r.leads, r.calls, r.hired)}</p>
                </div>
                {r.streak > 1 && (
                  <span className="badge bg-orange-100 text-orange-700" title={t("{0} يوم ورا بعض محقق هدفه", r.streak)}>
                    <Flame size={12} /> {r.streak}
                  </span>
                )}
                <span className="num text-lg font-bold"><CountUp value={r.points} /></span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-zinc-400">{t("النقط: ليد جديد 1 · مكالمة 1 · مقابلة 3 · تعيين 10")}</p>
    </section>
  );
}

export async function BadgesCard({ badges }: { badges: Badge[] }) {
  const t = await getT();
  const earned = badges.filter((b) => b.earned).length;
  return (
    <section className="card">
      <h2 className="card-title">🏅 {t("الشارات")} <span className="num text-sm font-normal text-zinc-400">{earned}/{badges.length}</span></h2>
      <ul className="grid grid-cols-3 gap-2">
        {badges.map((b) => (
          <li
            key={b.key}
            title={t(b.hint)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${b.earned ? "border-amber-200 bg-amber-50 animate-pop" : "border-zinc-200 opacity-55 grayscale"}`}
          >
            <span className="text-2xl">{b.icon}</span>
            <span className="text-[11px] leading-tight font-bold">{t(b.label)}</span>
            {!b.earned && b.progress && (
              <span className="num text-[10px] text-zinc-500">{b.progress[0]}/{b.progress[1]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
