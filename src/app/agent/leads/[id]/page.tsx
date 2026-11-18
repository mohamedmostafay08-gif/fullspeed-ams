import { LeadDetail } from "@/components/lead-detail";
import { requireRole } from "@/lib/auth";

export default async function AgentLeadPage({ params }: PageProps<"/agent/leads/[id]">) {
  await requireRole("agent");
  const { id } = await params;
  return <LeadDetail id={id} staff={false} />;
}
