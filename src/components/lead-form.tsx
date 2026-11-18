"use client";

import { useActionState, useMemo, useState } from "react";
import { createLead, type LeadFormState } from "@/app/actions/leads";
import { CompanyLogo } from "@/components/ui";
import type { Company, FormField, Governorate, Region } from "@/lib/types";
import { useT } from "@/lib/i18n/client";

type AgentOption = { id: string; full_name: string; company_ids: string[] };

export function LeadForm({
  companies,
  governorates,
  regions,
  agents,
  defaultCompanyId,
}: {
  companies: Pick<Company, "id" | "name" | "logo_path" | "form_schema">[];
  governorates: Governorate[];
  regions: Region[];
  agents?: AgentOption[];
  defaultCompanyId?: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<LeadFormState, FormData>(createLead, undefined);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  const [governorateId, setGovernorateId] = useState("");
  const company = companies.find((c) => c.id === companyId);
  const areaOptions = useMemo(() => regions.filter((r) => String(r.governorate_id) === governorateId), [regions, governorateId]);
  const agentOptions = agents?.filter((a) => a.company_ids.includes(companyId));

  if (companies.length === 0) {
    return <p className="card text-sm text-zinc-500">{t("مفيش شركات متعين عليها لسه — كلم التيم ليدر.")}</p>;
  }

  return (
    <form action={action} className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-semibold">{t("الشركة")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {companies.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs font-medium transition ${
                c.id === companyId ? "border-brand-500 bg-brand-50" : "border-zinc-200 hover:border-zinc-300"
              }`}
            >
              <input type="radio" name="company_id" value={c.id} checked={c.id === companyId} onChange={() => setCompanyId(c.id)} className="sr-only" />
              <CompanyLogo name={c.name} src={c.logo_path} size={44} />
              {c.name}
            </label>
          ))}
        </div>
      </section>

      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">{t("بيانات المتقدم")}</h2>
        <div>
          <label className="label" htmlFor="full_name">{t("الاسم بالكامل *")}</label>
          <input id="full_name" name="full_name" required minLength={3} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t("رقم الموبايل *")}</label>
          <input id="phone" name="phone" required inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" className="input text-right" />
        </div>
        <div>
          <label className="label" htmlFor="governorate_id">{t("المحافظة")}</label>
          <select id="governorate_id" name="governorate_id" className="input" value={governorateId} onChange={(e) => setGovernorateId(e.target.value)}>
            <option value="">—</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>{g.name_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="region_id">{t("المنطقة")}</label>
          <select id="region_id" name="region_id" className="input" disabled={!governorateId} key={governorateId}>
            <option value="">—</option>
            {areaOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name_ar}</option>
            ))}
          </select>
        </div>
        {agentOptions && (
          <div>
            <label className="label" htmlFor="agent_id">{t("الأجنت المسؤول")}</label>
            <select id="agent_id" name="agent_id" className="input">
              <option value="">{t("بدون")}</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="source">{t("مصدر الليد")}</label>
          <select id="source" name="source" className="input">
            <option value="manual">{t("إدخال يدوي")}</option>
            <option value="facebook">{t("إعلان فيسبوك")}</option>
            <option value="tiktok">{t("إعلان تيك توك")}</option>
            <option value="referral">{t("ترشيح")}</option>
            <option value="walk_in">{t("حضور للمقر")}</option>
          </select>
        </div>
      </section>

      {company && (company.form_schema as FormField[]).length > 0 && (
        <section className="card grid gap-4 sm:grid-cols-2" key={company.id}>
          <h2 className="font-semibold sm:col-span-2">{t("بيانات")} {company.name}</h2>
          {(company.form_schema as FormField[]).map((f) => (
            <CustomField key={f.key} field={f} />
          ))}
        </section>
      )}

      <section className="card">
        <label className="label" htmlFor="notes">{t("ملاحظات")}</label>
        <textarea id="notes" name="notes" rows={3} className="input" />
      </section>

      {state?.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {state.error}
          {state.duplicateOf && (
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" name="allow_duplicate" value="1" /> {t("سجّله برضه")}
            </label>
          )}
        </div>
      )}
      <button className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? t("جاري الحفظ...") : t("حفظ الليد")}
      </button>
    </form>
  );
}

function CustomField({ field }: { field: FormField }) {
  const name = `f_${field.key}`;
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
        <input type="checkbox" name={name} className="size-4 accent-brand-600" /> {field.label}
      </label>
    );
  }
  return (
    <div className={field.type === "textarea" ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={name}>{label}</label>
      {field.type === "select" ? (
        <select id={name} name={name} required={field.required} className="input">
          <option value="">—</option>
          {field.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea id={name} name={name} required={field.required} rows={3} className="input" />
      ) : (
        <input
          id={name}
          name={name}
          required={field.required}
          className="input"
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "phone" ? "tel" : undefined}
          dir={field.type === "phone" ? "ltr" : undefined}
        />
      )}
    </div>
  );
}
