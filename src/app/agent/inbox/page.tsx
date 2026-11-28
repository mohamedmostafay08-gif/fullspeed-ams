import { WaInbox } from "@/components/wa-inbox";
import { getViewAs, requireAgent } from "@/lib/view-as";

export default async function AgentInboxPage({ searchParams }: PageProps<"/agent/inbox">) {
  const me = await requireAgent();
  const viewing = Boolean(await getViewAs());
  return <WaInbox base="/agent/inbox" sp={await searchParams} staff={false} viewAsAgent={viewing ? me.id : undefined} />;
}
