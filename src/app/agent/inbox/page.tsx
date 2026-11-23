import { WaInbox } from "@/components/wa-inbox";
import { requireRole } from "@/lib/auth";

export default async function AgentInboxPage({ searchParams }: PageProps<"/agent/inbox">) {
  await requireRole("agent");
  return <WaInbox base="/agent/inbox" sp={await searchParams} staff={false} />;
}
