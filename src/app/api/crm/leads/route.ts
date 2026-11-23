import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isValidEgyptMobile, normalizePhone } from "@/lib/forms";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";

// Inbound: the CRM POSTs new leads here. Outbound: the CRM GETs status changes since a timestamp.
// Both require the shared secret in the `x-api-key` header.

const NOT_CONFIGURED = { error: "server key not configured" };

function authorized(request: NextRequest) {
  const secret = process.env.CRM_WEBHOOK_SECRET;
  const given = request.headers.get("x-api-key") ?? "";
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

type InboundLead = {
  external_id?: string | number;
  name?: string;
  full_name?: string;
  phone?: string;
  company?: string;
  governorate?: string;
  region?: string;
  source?: string;
  fields?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const t = await getT();
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasServiceKey()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const items = (Array.isArray(body) ? body : [body]) as InboundLead[];
  if (items.length > 500) return NextResponse.json({ error: "max 500 leads per request" }, { status: 413 });

  // Names and phones are checked here; the database does the rest of the batch in one call
  // (company, governorate, region, duplicates, agent, insert) and answers per lead.
  const prepared = items.map((item) => {
    const fullName = String(item.full_name ?? item.name ?? "").trim().slice(0, 120);
    const phone = normalizePhone(String(item.phone ?? ""));
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(item.fields ?? {}).slice(0, 50)) {
      if (v != null && v !== "") fields[k.slice(0, 60)] = String(v).slice(0, 500);
    }
    return {
      external_id: item.external_id != null ? String(item.external_id).slice(0, 100) : null,
      full_name: fullName,
      phone,
      valid: Boolean(fullName) && isValidEgyptMobile(phone),
      company: String(item.company ?? "").trim().toLowerCase(),
      governorate: item.governorate ? String(item.governorate).trim() : null,
      region: item.region ? String(item.region).trim() : null,
      source: item.source ? String(item.source).slice(0, 30) : null,
      fields,
    };
  });
  const { data: results, error } = await createAdminClient().rpc("crm_import_leads", { p_items: prepared, p_note: t("المصدر: {0}", "{0}") });
  if (error) return NextResponse.json({ error: "import failed" }, { status: 500 });
  return NextResponse.json({ results });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasServiceKey()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const since = request.nextUrl.searchParams.get("since");
  if (!since || Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "pass ?since=ISO-timestamp" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("leads")
    .select("id, external_id, phone, status, hired_at, updated_at, companies(slug), agent:profiles!leads_agent_id_fkey(full_name)")
    .gt("updated_at", new Date(since).toISOString())
    .order("updated_at")
    .limit(1000);
  if (error) return NextResponse.json({ error: "query failed" }, { status: 500 });

  return NextResponse.json({
    leads: (data ?? []).map((l) => ({
      id: l.id,
      external_id: l.external_id,
      phone: l.phone,
      company: (l.companies as unknown as { slug: string } | null)?.slug,
      agent: (l.agent as unknown as { full_name: string } | null)?.full_name ?? null,
      status: l.status,
      hired_at: l.hired_at,
      updated_at: l.updated_at,
    })),
  });
}
