import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { queryLeads, readFilters } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS, type FormField, type LeadStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!profile || profile.role === "agent") return new NextResponse("Forbidden", { status: 403 });

  const f = readFilters(Object.fromEntries(request.nextUrl.searchParams));
  const all: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data } = await queryLeads(f, { limit: 1000, offset });
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const { data: companies } = await (await createClient()).from("companies").select("form_schema");
  const labelOf = new Map<string, string>();
  for (const c of companies ?? []) for (const f of c.form_schema as FormField[]) if (!labelOf.has(f.key)) labelOf.set(f.key, f.label);

  const extraKeys = [...new Set(all.flatMap((l) => Object.keys((l.form_data as object) ?? {})))];
  const rows = [
    ["الاسم", "الموبايل", "الشركة", "المحافظة", "المنطقة", "الأجنت", "الحالة", "المصدر", "التاريخ", "ملاحظات", ...extraKeys.map((k) => labelOf.get(k) ?? k)],
    ...all.map((l) => {
      const fd = (l.form_data ?? {}) as Record<string, unknown>;
      return [
        l.full_name as string,
        l.phone as string,
        (l.companies as { name: string })?.name,
        (l.governorates as { name_ar: string } | null)?.name_ar,
        (l.regions as { name_ar: string } | null)?.name_ar,
        (l.agent as { full_name: string } | null)?.full_name,
        LEAD_STATUS_LABELS[l.status as LeadStatus],
        l.source as string,
        new Date(l.created_at as string).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
        l.notes as string,
        ...extraKeys.map((k) => (typeof fd[k] === "boolean" ? (fd[k] ? "نعم" : "لا") : (fd[k] as string))),
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
