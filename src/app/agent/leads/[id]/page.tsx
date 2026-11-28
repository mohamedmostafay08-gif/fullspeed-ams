import { LeadDetail } from "@/components/lead-detail";
import { requireAgent } from "@/lib/view-as";

export default async function AgentLeadPage({ params }: PageProps<"/agent/leads/[id]">) {
  await requireAgent();
  const { id } = await params;
  return <LeadDetail id={id} staff={false} />;
}
