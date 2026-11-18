import { AlertTriangle, CheckCircle2, LineChart } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export type Forecast = {
  month: string;
  workdays_total: number;
  workdays_done: number;
  leads: number;
  hired: number;
  target_leads: number;
  target_hired: number;
  projected_leads: number;
  projected_hired: number;
  agents: { id: string; name: string; hired: number; target_hired: number; projected_hired: number }[];
};

/** "At this pace you'll end the month at X hires" — with a warning when below 90% of target. */
export async function ForecastCard({ f, personal = false }: { f: Forecast; personal?: boolean }) {
  const t = await getT();
  const row = personal ? f.agents[0] : null;
  const hired = row ? row.hired : f.hired;
  const target = row ? row.target_hired : f.target_hired;
  const projected = row ? row.projected_hired : f.projected_hired;
  const ratio = target > 0 ? projected / target : null;
  const risk = ratio != null && ratio < 0.9;
  const pctDone = Math.round((f.workdays_done / Math.max(1, f.workdays_total)) * 100);
  const atRisk = personal ? [] : f.agents.filter((a) => a.target_hired > 0 && a.projected_hired < 0.9 * a.target_hired).slice(0, 4);

  return (
    <section className={`card ${risk ? "border-amber-300 bg-amber-50/40" : ""}`}>
      <h2 className="card-title">
        <LineChart size={18} className="text-violet-500" /> {personal ? t("توقعك للشهر") : t("توقع آخر الشهر")}
        <span className="num ms-auto text-xs font-normal text-zinc-400">{f.month}</span>
      </h2>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-zinc-500">{t("بالمعدل ده هتقفلوا الشهر بـ")}</p>
          <p className="num text-4xl font-bold">{projected} <span className="text-base font-semibold text-zinc-500">{t("تعيين")}</span></p>
        </div>
        <div className="text-sm text-zinc-600">
          <p>{t("لحد النهارده: {0}", hired)}{target > 0 && <> · {t("التارجت: {0}", target)}</>}</p>
          <p className="text-xs text-zinc-400">{t("عدّى {0} من {1} يوم شغل", f.workdays_done, f.workdays_total)}</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-violet-400" style={{ width: `${pctDone}%` }} />
      </div>
      {ratio != null && (
        <p className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${risk ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
          {risk ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {risk
            ? t("في خطر — محتاجين {0} تعيين في اليوم عشان نحقق التارجت", Math.max(0, Math.ceil((target - hired) / Math.max(1, f.workdays_total - f.workdays_done))))
            : t("ماشيين صح — {0}% من التارجت", Math.round(ratio * 100))}
        </p>
      )}
      {target === 0 && <p className="mt-3 text-xs text-zinc-400">{t("حط تارجت تعيين يومي للأجنتس عشان التوقع يقارن بيه")}</p>}
      {atRisk.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {atRisk.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5">
              <span className="font-semibold">{a.name}</span>
              <span className="num text-xs text-amber-800">{t("متوقع {0} من {1}", a.projected_hired, a.target_hired)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
