import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { readFilters } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

/**
 * Leads as an Excel-friendly CSV with every filter of the leads screen. The database writes the
 * whole file (row-level security still applies, as the signed-in user); this route only passes the
 * bytes through, so even tens of thousands of rows cost the server almost nothing.
 */
export async function GET(request: NextRequest) {
  const t = await getT();
  const profile = await getProfile();
  if (!profile || profile.role === "agent" || profile.role === "performance") return new NextResponse("Forbidden", { status: 403 });

  const f = readFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new NextResponse("Forbidden", { status: 403 });

  const p = {
    ...Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "page" && v != null && v !== "")),
    headers: [t("الاسم"), t("الموبايل"), t("الشركة"), t("المحافظة"), t("المنطقة"), t("الأجنت"), t("الحالة"), t("المصدر"), t("التاريخ"), t("ملاحظات")],
    status_labels: Object.fromEntries((Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => [s, t(LEAD_STATUS_LABELS[s])])),
    yes: t("نعم"),
    no: t("لا"),
  };
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/export_leads_csv`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Accept: "text/csv",
    },
    body: JSON.stringify({ p }),
  });
  if (!res.ok || !res.body) return new NextResponse(t("التصدير فشل، جرّب تاني"), { status: 502 });

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
