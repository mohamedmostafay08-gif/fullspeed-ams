import { notFound } from "next/navigation";
import { updateLead } from "@/app/actions/leads";
import { CompanyLogo, StatusBadge, formatDate } from "@/components/ui";
import { formatFieldValue } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, type FormField, type LeadStatus } from "@/lib/types";

export async function LeadDetail({ id, staff }: { id: string; staff: boolean }) {
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, full_name, phone, status, notes, source, form_data, created_at, hired_at, agent_id, company_id, companies(name, logo_path, form_schema), governorates(name_ar), regions(name_ar), agent:profiles!leads_agent_id_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!lead) notFound();

  const company = lead.companies as unknown as { name: string; logo_path: string | null; form_schema: FormField[] };
  const agent = lead.agent as unknown as { full_name: string } | null;
  const formData = (lead.form_data ?? {}) as Record<string, unknown>;
  const schemaKeys = new Set(company.form_schema.map((f) => f.key));
  const extraKeys = Object.keys(formData).filter((k) => !schemaKeys.has(k));

  const [{ data: activity }, agentsRes] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("id, from_status, to_status, note, created_at, actor:profiles(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    staff
      ? supabase.from("agent_companies").select("profiles!agent_companies_agent_id_fkey(id, full_name, is_active)").eq("company_id", lead.company_id)
      : Promise.resolve({ data: null }),
  ]);
  const agents = ((agentsRes.data ?? []) as unknown as { profiles: { id: string; full_name: string; is_active: boolean } | null }[])
    .map((r) => r.profiles)
    .filter((p): p is { id: string; full_name: string; is_active: boolean } => Boolean(p?.is_active));

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <section className="card">
          <div className="flex flex-wrap items-center gap-3">
            <CompanyLogo name={company.name} src={company.logo_path} size={48} />
            <div className="flex-1">
              <h1 className="text-xl font-bold">{lead.full_name}</h1>
              <p className="text-sm text-zinc-500">{company.name}</p>
            </div>
            <StatusBadge status={lead.status as LeadStatus} />
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <Row label="الموبايل">
              <a href={`tel:${lead.phone}`} dir="ltr" className="font-semibold text-brand-700">{lead.phone}</a>
              <a href={`https://wa.me/2${lead.phone}`} target="_blank" rel="noreferrer" className="mr-3 text-xs text-emerald-700">واتساب</a>
            </Row>
            <Row label="المحافظة / المنطقة">
              {(lead.governorates as unknown as { name_ar: string } | null)?.name_ar ?? "—"} / {(lead.regions as unknown as { name_ar: string } | null)?.name_ar ?? "—"}
            </Row>
            <Row label="الأجنت">{agent?.full_name ?? "غير معيّن"}</Row>
            <Row label="المصدر">{lead.source}</Row>
            <Row label="تاريخ التسجيل">{formatDate(lead.created_at)}</Row>
            {lead.hired_at && <Row label="تاريخ التعيين">{formatDate(lead.hired_at)}</Row>}
            {company.form_schema.map((f) => (
              <Row key={f.key} label={f.label}>{formatFieldValue(f, formData[f.key])}</Row>
            ))}
            {extraKeys.map((k) => (
              <Row key={k} label={k}>{formatFieldValue(undefined, formData[k])}</Row>
            ))}
          </dl>
        </section>

        <form action={updateLead} className="card space-y-3">
          <input type="hidden" name="id" value={lead.id} />
          <h2 className="font-semibold">تحديث الحالة</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="status">الحالة</label>
              <select id="status" name="status" defaultValue={lead.status} className="input">
                {Object.entries(LEAD_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {staff && (
              <div>
                <label className="label" htmlFor="agent_id">تحويل لأجنت</label>
                <select id="agent_id" name="agent_id" defaultValue={lead.agent_id ?? ""} className="input">
                  <option value="">بدون</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="notes">ملاحظات</label>
            <textarea id="notes" name="notes" defaultValue={lead.notes ?? ""} rows={3} className="input" />
          </div>
          <button className="btn-primary">حفظ</button>
        </form>
      </div>

      <section className="card h-fit">
        <h2 className="mb-3 font-semibold">سجل الحركة</h2>
        <ol className="space-y-3 text-sm">
          {(activity ?? []).map((a) => (
            <li key={a.id} className="border-r-2 border-brand-500 pr-3">
              <p className="font-medium">
                {a.from_status ? `${LEAD_STATUS_LABELS[a.from_status as LeadStatus]} ← ` : ""}
                {a.to_status ? LEAD_STATUS_LABELS[a.to_status as LeadStatus] : a.note}
              </p>
              <p className="text-xs text-zinc-500">
                {(a.actor as unknown as { full_name: string } | null)?.full_name ?? "النظام"} · {formatDate(a.created_at)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
