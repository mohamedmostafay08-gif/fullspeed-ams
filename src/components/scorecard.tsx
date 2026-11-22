import { ArrowDownRight, ArrowUpRight, Minus, Trophy } from "lucide-react";
import { Empty } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Numbers = {
  leads: number; hired: number; calls: number; interviews: number; talk_min: number;
  answer_rate: number | null; conversion: number | null; first_call_min: number | null;
};
type Card = { me: Numbers | null; team: Numbers; rank: number; agents: number } | null;

const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Egyptian work week: Saturday → Friday. "last" is the most recent complete week. */
export function weekRange(today: string, which: "last" | "current"): [string, string] {
  const sinceSaturday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7;
  const start = addDays(today, -sinceSaturday);
  return which === "current" ? [start, today] : [addDays(start, -7), addDays(start, -1)];
}

// Which direction is good for each number, and the tip shown when it's the weakest one.
const METRICS: { key: keyof Numbers; label: string; unit?: string; lowerIsBetter?: boolean; tip: string }[] = [
  { key: "hired", label: "اشتغلوا", tip: "ركّز على متابعة اللي عملوا مقابلة لحد ما يستلموا" },
  { key: "conversion", label: "نسبة التحويل", unit: "%", tip: "اسأل أسئلة السكربت كويس عشان تختار الكابتن المناسب من الأول" },
  { key: "answer_rate", label: "نسبة الرد", unit: "%", tip: "جرّب تكلم في أوقات مختلفة، وابعت واتساب قبل المكالمة" },
  { key: "first_call_min", label: "سرعة أول مكالمة", unit: "د", lowerIsBetter: true, tip: "كلّم الليد الجديد في أول نص ساعة — الكابتن بيبرد بسرعة" },
  { key: "calls", label: "المكالمات", tip: "استخدم «ابدأ المكالمات» عشان متضيعش وقت بين الليدز" },
  { key: "interviews", label: "المقابلات", tip: "حدد معاد المقابلة في نفس المكالمة لو الكابتن مهتم" },
  { key: "leads", label: "الليدز", tip: "سجّل كل ليد بيوصلك فوراً في السيستم" },
  { key: "talk_min", label: "دقايق الكلام", unit: "د", tip: "المكالمة الأطول بتقنع أكتر — اشرح المميزات كويس" },
];

export async function Scorecard({ agentId, from, to }: { agentId: string; from: string; to: string }) {
  const t = await getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("agent_scorecard", { p_agent: agentId, p_from: from, p_to: to });
  const card = data as Card;
  const me = card?.me;

  if (!card || !me) return <section className="card"><Empty>{t("مفيش بيانات")}</Empty></section>;

  const compare = (m: (typeof METRICS)[number]) => {
    const a = me[m.key];
    const b = card.team[m.key];
    if (a == null || b == null || Number(b) === 0) return 0;
    const diff = (Number(a) - Number(b)) / Number(b);
    if (Math.abs(diff) < 0.05) return 0;
    return (diff > 0) !== Boolean(m.lowerIsBetter) ? 1 : -1;
  };
  const weakest = METRICS.filter((m) => compare(m) < 0).slice(0, 2);
  const strong = METRICS.filter((m) => compare(m) > 0).slice(0, 2);

  return (
    <>
      <section className="card">
        <h2 className="card-title"><Trophy size={18} className="text-amber-500" /> {t("ترتيبك في التعيينات: {0} من {1}", card.rank, card.agents)}</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t("المقياس")}</th><th>{t("إنت")}</th><th>{t("متوسط الفريق")}</th><th /></tr></thead>
            <tbody>
              {METRICS.map((m) => {
                const c = compare(m);
                const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(Number(v) * 10) / 10}${m.unit ? ` ${t(m.unit)}` : ""}`);
                return (
                  <tr key={m.key}>
                    <td className="font-semibold">{t(m.label)}</td>
                    <td className="num font-bold">{fmt(me[m.key])}</td>
                    <td className="num text-zinc-500">{fmt(card.team[m.key])}</td>
                    <td>
                      {c > 0 ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><ArrowUpRight size={15} /> {t("أحسن")}</span>
                        : c < 0 ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600"><ArrowDownRight size={15} /> {t("أقل")}</span>
                        : <span className="inline-flex items-center gap-1 text-sm text-zinc-400"><Minus size={15} /> {t("زي المتوسط")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="card">
          <h3 className="mb-2 font-bold text-emerald-700">💪 {t("نقط قوتك")}</h3>
          {strong.length ? <ul className="list-disc space-y-1 ps-5 text-sm">{strong.map((m) => <li key={m.key}>{t(m.label)}</li>)}</ul> : <p className="text-sm text-zinc-500">{t("كمّل كده وهتلاقي نفسك فوق المتوسط")}</p>}
        </section>
        <section className="card">
          <h3 className="mb-2 font-bold text-brand-700">🎯 {t("تركّز على إيه الفترة الجاية")}</h3>
          {weakest.length ? <ul className="list-disc space-y-1 ps-5 text-sm">{weakest.map((m) => <li key={m.key}><b>{t(m.label)}:</b> {t(m.tip)}</li>)}</ul> : <p className="text-sm text-zinc-500">{t("مفيش حاجة أقل من المتوسط — برافو!")}</p>}
        </section>
      </div>
    </>
  );
}
