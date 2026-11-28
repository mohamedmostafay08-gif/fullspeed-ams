"use client";

import { useActionState, useMemo, useState } from "react";
import { Target } from "lucide-react";
import { qualifyLead } from "@/app/actions/acquisition";
import { useLocale, useT } from "@/lib/i18n/client";
import { FIT_MISSES, FIT_UNKNOWN, placeName, VEHICLES, type Governorate, type LeadFit, type Region } from "@/lib/types";

type Props = {
  leadId: string;
  governorateId: number | null;
  regionId: number | null;
  vehicle: string | null;
  hasLicense: boolean | null;
  age: number | null;
  governorates: Governorate[];
  regions: Region[];
  fit: LeadFit[] | null;
  readOnly?: boolean;
};

/** Four quick questions (area, vehicle, licence, age) and which companies the answers fit. */
export function QualifyCard(p: Props) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(qualifyLead, undefined);
  const [gov, setGov] = useState(p.governorateId ? String(p.governorateId) : "");
  const areaOptions = useMemo(() => p.regions.filter((r) => String(r.governorate_id) === gov), [p.regions, gov]);
  const missing = [!p.governorateId && t("المحافظة"), !p.vehicle && t("المركبة")].filter(Boolean) as string[];
  const own = p.fit?.find((f) => f.own);
  const others = (p.fit ?? []).filter((f) => !f.own && f.fits).slice(0, 6);
  const why = (f: LeadFit) => f.misses.map((m) => t(FIT_MISSES[m] ?? m)).join("، ");

  return (
    <section className="card" id="qualify">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="card-title mb-0"><Target size={18} className="text-brand-600" /> {t("تأهيل سريع")}</h2>
        {missing.length > 0 ? (
          <span className="chip border-amber-300 bg-amber-50 text-amber-800">{t("ناقص: {0}", missing.join("، "))}</span>
        ) : (
          <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800">✅ {t("متأهل")}</span>
        )}
      </div>

      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={p.leadId} />
        <fieldset disabled={p.readOnly || pending} className="contents">
          <div>
            <label className="label" htmlFor="q_gov">{t("المحافظة")}</label>
            <select id="q_gov" name="governorate_id" className="input" value={gov} onChange={(e) => setGov(e.target.value)}>
              <option value="">—</option>
              {p.governorates.map((g) => <option key={g.id} value={g.id}>{placeName(g, locale)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q_region">{t("المنطقة")}</label>
            <select id="q_region" name="region_id" className="input" disabled={!gov} key={gov} defaultValue={gov === String(p.governorateId ?? "") && p.regionId ? String(p.regionId) : ""}>
              <option value="">—</option>
              {areaOptions.map((r) => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <span className="label">{t("المركبة")}</span>
            <div className="flex flex-wrap gap-1.5">
              {VEHICLES.map((v) => (
                <label key={v} className="chip cursor-pointer has-checked:border-(--fg) has-checked:bg-(--fg) has-checked:text-(--surface)">
                  <input type="radio" name="vehicle" value={v} defaultChecked={p.vehicle === v} className="sr-only" />
                  {t(v)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="label">{t("رخصة سارية؟")}</span>
            <div className="flex flex-wrap gap-1.5">
              {([["yes", "أيوه"], ["no", "لأ"], ["", "مش عارف"]] as const).map(([v, l]) => (
                <label key={v || "unknown"} className="chip cursor-pointer has-checked:border-(--fg) has-checked:bg-(--fg) has-checked:text-(--surface)">
                  <input type="radio" name="has_license" value={v} defaultChecked={(p.hasLicense === true && v === "yes") || (p.hasLicense === false && v === "no") || (p.hasLicense === null && v === "")} className="sr-only" />
                  {t(l)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="q_age">{t("السن")}</label>
            <input id="q_age" name="age" type="number" inputMode="numeric" min={16} max={70} defaultValue={p.age ?? ""} className="input num" />
          </div>
          {!p.readOnly && (
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button className="btn-primary" disabled={pending}>{pending ? t("جاري...") : t("احفظ التأهيل")}</button>
              {state?.error && <p role="alert" className="text-sm text-rose-600">{state.error}</p>}
              {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
            </div>
          )}
        </fieldset>
      </form>

      {p.fit === null ? (
        <p className="mt-3 text-xs text-zinc-500">{t("الجزء ده محتاج migration 0060 — اتأكد إنه اتطبق في Supabase")}</p>
      ) : (
        <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3 text-sm">
          {own && (
            own.fits ? (
              <p className="text-emerald-700">✅ {t("مناسب لـ {0}", own.name)}{own.unknown.length > 0 && <span className="text-zinc-500"> · {t("لسه مش متأكدين من: {0}", own.unknown.map((m) => t(FIT_UNKNOWN[m] ?? m)).join("، "))}</span>}</p>
            ) : (
              <p className="font-semibold text-rose-700">⚠️ {t("مش مناسب لـ {0}: {1}", own.name, why(own))}</p>
            )
          )}
          {others.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-500">{t("يناسب كمان:")}</span>
              {others.map((f) => (
                <span key={f.company_id} className="chip">
                  {f.name}
                  {(f.requests ?? 0) > 0 && <span className="text-amber-700"> · 📦 {t("طالبة")}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
