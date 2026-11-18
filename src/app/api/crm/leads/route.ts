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

  const db = createAdminClient();
  const [{ data: companies }, { data: govs }, { data: regions }] = await Promise.all([
    db.from("companies").select("id, name, slug, is_active"),
    db.from("governorates").select("id, name_ar, name_en"),
    db.from("regions").select("id, governorate_id, name_ar").limit(5000),
  ]);
  const companyByKey = new Map<string, { id: string; is_active: boolean }>();
  for (const c of companies ?? []) {
    companyByKey.set(c.slug, c);
    companyByKey.set(c.name.toLowerCase(), c);
  }
  const govByName = new Map<string, number>();
  for (const g of govs ?? []) {
    govByName.set(g.name_ar, g.id);
    govByName.set(g.name_en.toLowerCase(), g.id);
  }

  const results = [];
  for (const item of items) {
    const externalId = item.external_id != null ? String(item.external_id).slice(0, 100) : null;
    const fullName = String(item.full_name ?? item.name ?? "").trim().slice(0, 120);
    const phone = normalizePhone(String(item.phone ?? ""));
    const company = companyByKey.get(String(item.company ?? "").trim().toLowerCase());
    if (!fullName || !isValidEgyptMobile(phone) || !company?.is_active) {
      results.push({ external_id: externalId, status: "rejected", reason: !company?.is_active ? "unknown company" : "invalid name/phone" });
      continue;
    }

    const { data: taken } = await db.rpc("lead_phone_taken", { p_company: company.id, p_phone: phone });
    if (taken) {
      results.push({ external_id: externalId, status: "duplicate" });
      continue;
    }

    const govId = item.governorate ? govByName.get(item.governorate.trim()) ?? govByName.get(item.governorate.trim().toLowerCase()) ?? null : null;
    const regionId = item.region ? (regions ?? []).find((r) => r.name_ar === item.region!.trim() && (!govId || r.governorate_id === govId))?.id ?? null : null;
    const { data: agentId } = await db.rpc("pick_agent_for_company", { p_company: company.id });

    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(item.fields ?? {}).slice(0, 50)) {
      if (v != null && v !== "") fields[k.slice(0, 60)] = String(v).slice(0, 500);
    }

    const source = `crm${item.source ? `:${String(item.source).slice(0, 30)}` : ""}`;
    const { data, error } = await db
      .from("leads")
      .insert({
        company_id: company.id,
        agent_id: agentId ?? null,
        full_name: fullName,
        phone,
        governorate_id: govId,
        region_id: regionId,
        form_data: fields,
        source: "crm",
        external_id: externalId,
        notes: source !== "crm" ? t("المصدر: {0}", source) : null,
      })
      .select("id")
      .single();
    if (error) {
      results.push({
        external_id: externalId,
        status: error.code === "23505" ? "duplicate" : error.message.includes("BLACKLISTED") ? "blacklisted" : "error",
      });
      continue;
    }
    results.push({ external_id: externalId, status: "created", id: data.id, assigned: Boolean(agentId) });
  }

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
