import { AccountPage } from "@/components/account-page";
import { requireAgent } from "@/lib/view-as";

export default async function AgentAccount() {
  return <AccountPage profile={await requireAgent()} />;
}
