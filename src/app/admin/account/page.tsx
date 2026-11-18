import { AccountPage } from "@/components/account-page";
import { requireRole, STAFF } from "@/lib/auth";

export default async function AdminAccount() {
  return <AccountPage profile={await requireRole(...STAFF)} />;
}
