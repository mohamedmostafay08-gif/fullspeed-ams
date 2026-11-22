import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { readFilters } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, type FormField, type LeadStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

export async function GET(request: NextRequest) {
  const t = await getT();
  const profile = await getProfile();
  if (!profile || profile.role === "agent") return new NextResponse("Forbidden", { status: 403 });

  const f = readFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();
  // One database call (row-level security still applies), instead of paging through the API.
  const { data } = await supabase.rpc("export_leads", {
    p_company: f.company ?? null,
    p_agent: f.agent ?? null,
    p_status: f.status ?? null,
    p_from: f.from ?? null,
    p_to: f.to ?? f.from ?? null,
    p_q: f.q?.replace(/[%_\\]/g, "") || null,
  });
  const all = (data ?? []) as { full_name: string; phone: string; company: string; governorate: string | null; region: string | null; agent: string | null; status: string; source: string; created_at: string; notes: string | null; form_data: Record<string, unknown> | null }[];

  const { data: companies } = await supabase.from("companies").select("form_schema");
  const labelOf = new Map<string, string>();
  for (const c of companies ?? []) for (const f of c.form_schema as FormField[]) if (!labelOf.has(f.key)) labelOf.set(f.key, f.label);

  const extraKeys = [...new Set(all.flatMap((l) => Object.keys((l.form_data as object) ?? {})))];
  const rows = [
    [t("الاسم"), t("الموبايل"), t("الشركة"), t("المحافظة"), t("المنطقة"), t("الأجنت"), t("الحالة"), t("المصدر"), t("التاريخ"), t("ملاحظات"), ...extraKeys.map((k) => labelOf.get(k) ?? k)],
    ...all.map((l) => {
      const fd = (l.form_data ?? {}) as Record<string, unknown>;
      return [
        l.full_name,
        l.phone,
        l.company,
        l.governorate,
        l.region,
        l.agent,
        t(LEAD_STATUS_LABELS[l.status as LeadStatus]),
        l.source,
        new Date(l.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
        l.notes,
        ...extraKeys.map((k) => (typeof fd[k] === "boolean" ? (fd[k] ? t("نعم") : t("لا")) : (fd[k] as string))),
      ];
    }),
  ];

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
