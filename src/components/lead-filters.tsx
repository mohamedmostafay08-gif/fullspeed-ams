import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { SavedFilters } from "@/components/saved-filters";
import { ATTEMPTS, DATE_FIELDS, FLAGS, SORTS, filtersToQuery, hasAdvanced, type LeadFilters } from "@/lib/lead-query";
import { getT } from "@/lib/i18n/server";
import { LEAD_SOURCES, LEAD_STATUS_LABELS, REJECT_REASONS, type FormField } from "@/lib/types";

type Opt = { id: string; name: string };

/** Basic filters in one row, everything else in a panel; active filters show as removable chips. */
export async function LeadFilterForm({
  f, view, path, companies, agents, teams, governorates,
}: {
  f: LeadFilters;
  view: "table" | "board";
  path: string;
  companies: (Opt & { form_schema: FormField[] })[];
  agents?: Opt[];
  teams?: Opt[];
  governorates: { id: number; name: string }[];
}) {
  const t = await getT();
  const company = companies.find((c) => c.id === f.company);
  const fields = (company?.form_schema ?? []).filter((x) => x.type !== "date");
  const field = fields.find((x) => x.key === f.fkey);

  // Chip labels for the filters in force, each with a link that drops just that one.
  const label: Record<string, string | undefined> = {
    company: company?.name,
    agent: f.agent === "none" ? t("غير معيّن") : agents?.find((a) => a.id === f.agent)?.name,
    team: teams?.find((x) => x.id === f.team)?.name,
    status: f.status && t(LEAD_STATUS_LABELS[f.status as keyof typeof LEAD_STATUS_LABELS]),
    gov: governorates.find((g) => String(g.id) === f.gov)?.name,
    source: f.source && t(LEAD_SOURCES[f.source]),
    reason: f.reason && t(REJECT_REASONS[f.reason as keyof typeof REJECT_REASONS]),
    attempts: f.attempts && t(ATTEMPTS[f.attempts]),
    flag: f.flag && t(FLAGS[f.flag]),
    from: f.from && `${t(f.datefield ? DATE_FIELDS[f.datefield] : "من")} ≥ ${f.from}`,
    to: f.to && `≤ ${f.to}`,
    q: f.q && `«${f.q}»`,
    fkey: f.fkey && f.fval ? `${field?.label ?? f.fkey}: ${f.fval}` : undefined,
    sort: f.sort && t(SORTS[f.sort]),
  };
  const without = (k: keyof LeadFilters) => {
    const rest = { ...f, [k]: undefined, ...(k === "fkey" ? { fval: undefined } : {}), ...(k === "company" ? { fkey: undefined, fval: undefined } : {}) };
    const qs = filtersToQuery(rest as LeadFilters);
    return `${path}?${qs}${view === "board" ? `${qs ? "&" : ""}view=board` : ""}`;
  };
  const active = (Object.keys(label) as (keyof LeadFilters)[]).filter((k) => label[k]);
  const query = filtersToQuery({ ...f, page: 1 });

  return (
    <section className="card mb-4 space-y-3">
      <form className="space-y-3">
        {view === "board" && <input type="hidden" name="view" value="board" />}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <input name="q" defaultValue={f.q} placeholder={t("اسم أو موبايل")} className="input lg:col-span-2" />
          <select name="company" defaultValue={f.company ?? ""} className="input" aria-label={t("الشركة")}>
            <option value="">{t("كل الشركات")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {agents ? (
            <select name="agent" defaultValue={f.agent ?? ""} className="input" aria-label={t("الأجنت")}>
              <option value="">{t("كل الأجنتس")}</option>
              <option value="none">{t("غير معيّن")}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <select name="flag" defaultValue={f.flag ?? ""} className="input" aria-label={t("حالة المتابعة")}>
              <option value="">{t("كل المتابعات")}</option>
              {Object.entries(FLAGS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
            </select>
          )}
          <select name="status" defaultValue={f.status ?? ""} className="input" aria-label={t("الحالة")}>
            <option value="">{t("كل الحالات")}</option>
            {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
          <input type="date" name="from" defaultValue={f.from} className="input" aria-label={t("من")} />
          <input type="date" name="to" defaultValue={f.to} className="input" aria-label={t("إلى")} />
        </div>

        <details open={hasAdvanced(f)} className="group rounded-2xl border border-(--glass-line) p-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-600">
            <SlidersHorizontal size={16} /> {t("فلاتر متقدمة")}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {teams && (
              <label className="block"><span className="label">{t("التيم")}</span>
                <select name="team" defaultValue={f.team ?? ""} className="input">
                  <option value="">{t("كل التيمات")}</option>
                  {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className="label">{t("المحافظة")}</span>
              <select name="gov" defaultValue={f.gov ?? ""} className="input">
                <option value="">{t("كل المحافظات")}</option>
                {governorates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">{t("المصدر")}</span>
              <select name="source" defaultValue={f.source ?? ""} className="input">
                <option value="">{t("كل المصادر")}</option>
                {Object.entries(LEAD_SOURCES).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">{t("سبب الرفض")}</span>
              <select name="reason" defaultValue={f.reason ?? ""} className="input">
                <option value="">{t("أي سبب")}</option>
                {Object.entries(REJECT_REASONS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">{t("محاولات الاتصال")}</span>
              <select name="attempts" defaultValue={f.attempts ?? ""} className="input">
                <option value="">{t("أي عدد")}</option>
                {Object.entries(ATTEMPTS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </label>
            {agents && (
              <label className="block"><span className="label">{t("حالة المتابعة")}</span>
                <select name="flag" defaultValue={f.flag ?? ""} className="input">
                  <option value="">{t("كل المتابعات")}</option>
                  {Object.entries(FLAGS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className="label">{t("التاريخ ده يبقى")}</span>
              <select name="datefield" defaultValue={f.datefield ?? ""} className="input">
                <option value="">{t(DATE_FIELDS.created)}</option>
                <option value="hired">{t(DATE_FIELDS.hired)}</option>
                <option value="contact">{t(DATE_FIELDS.contact)}</option>
              </select>
            </label>
            <label className="block"><span className="label">{t("الترتيب")}</span>
              <select name="sort" defaultValue={f.sort ?? ""} className="input">
                <option value="">{t(SORTS.new)}</option>
                <option value="old">{t(SORTS.old)}</option>
                <option value="attempts">{t(SORTS.attempts)}</option>
                <option value="contact">{t(SORTS.contact)}</option>
              </select>
            </label>
            {company && fields.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <label className="block"><span className="label">{t("سؤال من فورم {0}", company.name)}</span>
                  <select name="fkey" defaultValue={f.fkey ?? ""} className="input">
                    <option value="">—</option>
                    {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">{t("الإجابة")}</span>
                  {field?.options?.length ? (
                    <select name="fval" defaultValue={f.fval ?? ""} className="input">
                      <option value="">—</option>
                      {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input name="fval" defaultValue={f.fval} className="input" placeholder={t("اختار السؤال الأول")} />
                  )}
                </label>
              </div>
            ) : (
              <p className="self-end text-xs text-zinc-500 sm:col-span-2">{t("اختار شركة عشان تفلتر بإجابات الفورم بتاعها (نوع المركبة، السن…)")}</p>
            )}
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary">{t("فلتر")}</button>
          {active.length > 0 && <Link href={`${path}${view === "board" ? "?view=board" : ""}`} className="btn-ghost">{t("امسح كل الفلاتر")}</Link>}
        </div>
      </form>

      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((k) => (
            <Link key={k} href={without(k)} className="chip gap-1 border-brand-200 bg-brand-50 text-brand-700">
              {label[k]} <X size={12} />
            </Link>
          ))}
        </div>
      )}
      <SavedFilters page="leads" path={path} query={query} />
    </section>
  );
}
