import { PageHeader } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { requireRole, STAFF } from "@/lib/auth";
import { getCompanies, getGeo } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AdminNewLeadPage() {
  const t = await getT();
  await requireRole(...STAFF);
  const supabase = await createClient();
  const [companies, geo, { data: assignments }] = await Promise.all([
    getCompanies(true),
    getGeo(),
    supabase.from("agent_companies").select("company_id, profiles!agent_companies_agent_id_fkey(id, full_name, is_active)"),
  ]);
  const agents = new Map<string, { id: string; full_name: string; company_ids: string[] }>();
  for (const a of (assignments ?? []) as unknown as { company_id: string; profiles: { id: string; full_name: string; is_active: boolean } | null }[]) {
    if (!a.profiles?.is_active) continue;
    const entry = agents.get(a.profiles.id) ?? { id: a.profiles.id, full_name: a.profiles.full_name, company_ids: [] };
    entry.company_ids.push(a.company_id);
    agents.set(a.profiles.id, entry);
  }
  return (
    <>
      <PageHeader title={t("ليد جديد")} />
      <LeadForm companies={companies} {...geo} agents={[...agents.values()]} />
    </>
  );
}
