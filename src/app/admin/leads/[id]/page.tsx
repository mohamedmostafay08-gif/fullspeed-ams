import { LeadDetail } from "@/components/lead-detail";
import { requireRole } from "@/lib/auth";

export default async function AdminLeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  await requireRole("admin", "team_leader");
  const { id } = await params;
  return <LeadDetail id={id} staff />;
}
