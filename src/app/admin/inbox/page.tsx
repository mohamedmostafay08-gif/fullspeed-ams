import { WaInbox } from "@/components/wa-inbox";
import { STAFF, requireRole } from "@/lib/auth";

export default async function AdminInboxPage({ searchParams }: PageProps<"/admin/inbox">) {
  await requireRole(...STAFF);
  return <WaInbox base="/admin/inbox" sp={await searchParams} staff />;
}
