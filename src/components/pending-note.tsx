import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/** Pages that used to hold their own "waiting for you" list now point to the one approvals inbox. */
export async function PendingInApprovals({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  const t = await getT();
  return (
    <Link
      href="/admin/approvals"
      className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
    >
      <Inbox size={18} className="shrink-0" />
      <span className="flex-1">{label}</span>
      <span className="inline-flex items-center gap-1 text-xs">{t("افتح الموافقات")} <ArrowLeft size={14} className="ltr:rotate-180" /></span>
    </Link>
  );
}
