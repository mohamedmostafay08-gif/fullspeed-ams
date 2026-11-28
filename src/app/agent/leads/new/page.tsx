import { PageHeader } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { requireAgent } from "@/lib/view-as";
import { getAssignedCompanies, getGeo } from "@/lib/data";
import { getT } from "@/lib/i18n/server";

export default async function AgentNewLeadPage({ searchParams }: PageProps<"/agent/leads/new">) {
  const t = await getT();
  const profile = await requireAgent();
  const sp = await searchParams;
  const [companies, geo] = await Promise.all([getAssignedCompanies(profile.id), getGeo()]);
  const requested = typeof sp.company === "string" ? sp.company : undefined;
  return (
    <>
      <PageHeader title={t("ليد جديد")} subtitle={t("سجّل بيانات المتقدم من الإعلان")} />
      <LeadForm
        companies={companies}
        {...geo}
        defaultCompanyId={companies.some((c) => c.id === requested) ? requested : undefined}
      />
    </>
  );
}
