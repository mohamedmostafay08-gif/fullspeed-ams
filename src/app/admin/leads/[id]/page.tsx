import { LeadDetail } from "@/components/lead-detail";
import { requireRole, STAFF } from "@/lib/auth";

export default async function AdminLeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  await requireRole(...STAFF);
  const { id } = await params;
  return <LeadDetail id={id} staff />;
}
