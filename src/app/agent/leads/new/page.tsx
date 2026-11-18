import { PageHeader } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { requireRole } from "@/lib/auth";
import { getAssignedCompanies, getGeo } from "@/lib/data";

export default async function AgentNewLeadPage({ searchParams }: PageProps<"/agent/leads/new">) {
  const profile = await requireRole("agent");
  const sp = await searchParams;
  const [companies, geo] = await Promise.all([getAssignedCompanies(profile.id), getGeo()]);
  const requested = typeof sp.company === "string" ? sp.company : undefined;
  return (
    <>
      <PageHeader title="ليد جديد" subtitle="سجّل بيانات المتقدم من الإعلان" />
      <LeadForm
        companies={companies}
        {...geo}
        defaultCompanyId={companies.some((c) => c.id === requested) ? requested : undefined}
      />
    </>
  );
}
