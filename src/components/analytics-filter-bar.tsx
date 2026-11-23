import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { SavedFilters } from "@/components/saved-filters";
import { AF_KEYS, afQuery, type AnalyticsFilters } from "@/lib/analytics-filters";
import { getT } from "@/lib/i18n/server";
import { LEAD_SOURCES } from "@/lib/types";

type Opt = { id: string; name: string };

/** Team / company / agent / source / governorate filters, kept across tabs and date presets. */
export async function AnalyticsFilterBar({
  path, f, keep, teams, companies, agents, governorates, saved = true,
}: {
  path: string;
  f: AnalyticsFilters;
  keep: Record<string, string>;
  teams: Opt[];
  companies: Opt[];
  agents: Opt[];
  governorates: { id: number; name: string }[];
  saved?: boolean;
}) {
  const t = await getT();
  const label: Record<string, string | undefined> = {
    team: teams.find((x) => x.id === f.team)?.name,
    company: companies.find((x) => x.id === f.company)?.name,
    agent: agents.find((x) => x.id === f.agent)?.name,
    source: f.source && t(LEAD_SOURCES[f.source]),
    gov: governorates.find((g) => String(g.id) === f.gov)?.name,
  };
  const link = (next: AnalyticsFilters) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of new URLSearchParams(afQuery(next))) p.set(k, v);
    return `${path}?${p}`;
  };
  const active = AF_KEYS.filter((k) => label[k]);
  return (
    <section className="card mb-6 space-y-3">
      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <select name="team" defaultValue={f.team ?? ""} className="input" aria-label={t("التيم")}>
          <option value="">{t("كل التيمات")}</option>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="company" defaultValue={f.company ?? ""} className="input" aria-label={t("الشركة")}>
          <option value="">{t("كل الشركات")}</option>
          {companies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="agent" defaultValue={f.agent ?? ""} className="input" aria-label={t("الأجنت")}>
          <option value="">{t("كل الأجنتس")}</option>
          {agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="source" defaultValue={f.source ?? ""} className="input" aria-label={t("المصدر")}>
          <option value="">{t("كل المصادر")}</option>
          {Object.entries(LEAD_SOURCES).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <select name="gov" defaultValue={f.gov ?? ""} className="input" aria-label={t("المحافظة")}>
          <option value="">{t("كل المحافظات")}</option>
          {governorates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="btn-primary"><SlidersHorizontal size={16} /> {t("فلتر")}</button>
      </form>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((k) => (
            <Link key={k} href={link({ ...f, [k]: undefined })} className="chip gap-1 border-brand-200 bg-brand-50 text-brand-700">
              {label[k]} <X size={12} />
            </Link>
          ))}
          <Link href={link({})} className="chip">{t("امسح كل الفلاتر")}</Link>
        </div>
      )}
      {saved && <SavedFilters page="analytics" path={path} query={new URLSearchParams({ ...keep, ...Object.fromEntries(new URLSearchParams(afQuery(f))) }).toString()} />}
    </section>
  );
}
