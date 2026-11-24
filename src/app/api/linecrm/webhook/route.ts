import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/app-config";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";

/**
 * LineCRM event notifications (Developers & API → إشعارات الأحداث).
 * Step one: keep every delivery so its real shape can be read in «النسخ والتكاملات».
 * LineCRM doesn't publish its signature format, so the common HMAC-SHA256 layouts are tried
 * and the one that matched is recorded. Once the secret is saved, unsigned deliveries are refused.
 */

const MAX_BYTES = 200_000;
const LINECRM_API = "https://linecrm.app/api/v1";

/** lead.created carries no phone: read the full lead from LineCRM with the read-only key. */
async function fetchLead(leadId: string, key: string): Promise<{ details: unknown; error: string | null }> {
  const get = (path: string) =>
    fetch(`${LINECRM_API}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  try {
    let res = await get(`/leads/${encodeURIComponent(leadId)}`);
    if (res.status === 404 || res.status === 405) res = await get(`/leads?q=${encodeURIComponent(leadId)}`);
    const text = await res.text();
    let body: unknown = text.slice(0, 50_000);
    try {
      body = JSON.parse(text);
    } catch {}
    return res.ok ? { details: body, error: null } : { details: body, error: `HTTP ${res.status}` };
  } catch (e) {
    return { details: null, error: e instanceof Error ? e.message.slice(0, 200) : "fetch failed" };
  }
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Returns the name of the scheme the signature matched, or null. */
function verify(raw: string, header: string, secret: string): string | null {
  if (!header || !secret) return null;
  const mac = (data: string) => createHmac("sha256", secret).update(data);
  const hex = mac(raw).digest("hex");
  const b64 = mac(raw).digest("base64");
  const value = header.trim();
  const bare = value.replace(/^sha256=/i, "");
  if (same(bare.toLowerCase(), hex)) return value.toLowerCase().startsWith("sha256=") ? "sha256=hex(body)" : "hex(body)";
  if (same(bare, b64)) return "base64(body)";
  // "t=<timestamp>,v1=<hex>" style: the timestamp is signed together with the body.
  const parts = Object.fromEntries(value.split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2));
  const t = parts.t ?? parts.ts ?? parts.timestamp;
  const v = parts.v1 ?? parts.sig ?? parts.signature ?? parts.sha256;
  if (t && v) {
    if (same(v.toLowerCase(), mac(`${t}.${raw}`).digest("hex"))) return "t.body hex";
    if (same(v, mac(`${t}.${raw}`).digest("base64"))) return "t.body base64";
  }
  return null;
}

export async function POST(request: Request) {
  if (!hasServiceKey()) return Response.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });

  const cfg = await getConfig();
  const secret = cfg.linecrm_webhook_secret ?? "";
  const signature = request.headers.get("x-linecrm-signature") ?? "";
  const scheme = verify(raw, signature, secret);
  const db = createAdminClient();

  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    payload = null;
  }
  const eventId = typeof payload?.id === "string" || typeof payload?.id === "number" ? String(payload.id).slice(0, 200) : null;
  const type = String(payload?.type ?? payload?.event ?? "").slice(0, 80) || null;

  if (secret && !scheme) {
    // Kept (a few a day) only so a mismatched signature format can be diagnosed.
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await db.from("linecrm_events").select("id", { count: "exact", head: true }).eq("status", "bad_signature").gte("created_at", since);
    if ((count ?? 0) < 20) {
      await db.from("linecrm_events").insert({
        id: `bad:${randomUUID()}`, type, payload: null, raw: raw.slice(0, 20_000), signature: signature.slice(0, 500), verified: false, status: "bad_signature",
      });
    }
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  if (!secret) {
    // Before the secret is saved anyone could post here: keep only a handful.
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await db.from("linecrm_events").select("id", { count: "exact", head: true }).eq("status", "unverified").gte("created_at", since);
    if ((count ?? 0) >= 50) return Response.json({ error: "save the signing secret first" }, { status: 429 });
  }

  const { error } = await db.from("linecrm_events").upsert(
    { id: eventId ?? `noid:${randomUUID()}`, type, payload, raw: raw.slice(0, MAX_BYTES), signature: signature.slice(0, 500), verified: Boolean(scheme), scheme, status: secret ? "received" : "unverified" },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) return Response.json({ error: "store failed" }, { status: 500 });

  const data = payload?.data as { id?: unknown } | undefined;
  if (scheme && type === "lead.created" && eventId && cfg.linecrm_api_key && (typeof data?.id === "string" || typeof data?.id === "number")) {
    const { data: row } = await db.from("linecrm_events").select("details").eq("id", eventId).maybeSingle();
    if (row && row.details == null) {
      const { details, error: detailError } = await fetchLead(String(data.id), cfg.linecrm_api_key);
      await db.from("linecrm_events").update({ details, detail_error: detailError }).eq("id", eventId);
    }
  }
  return Response.json({ ok: true });
}
