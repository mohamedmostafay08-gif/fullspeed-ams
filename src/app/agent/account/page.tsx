import { AccountPage } from "@/components/account-page";
import { requireRole } from "@/lib/auth";

export default async function AgentAccount() {
  return <AccountPage profile={await requireRole("agent")} />;
}
