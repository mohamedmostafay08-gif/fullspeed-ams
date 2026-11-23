import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/app-config";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";

/**
 * One webhook for everything Meta sends:
 *  - WhatsApp Cloud API: incoming messages and delivery/read receipts (object "whatsapp_business_account").
 *  - Facebook Page lead ads: a new form submission (object "page", field "leadgen").
 * Set it up in the Meta app dashboard with this URL and the verify token shown in «النسخ والتكاملات».
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Meta checks the URL once with a GET and expects the challenge echoed back. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cfg = await getConfig();
  const token = url.searchParams.get("hub.verify_token") ?? "";
  if (url.searchParams.get("hub.mode") === "subscribe" && cfg.meta_verify_token && safeEqual(token, cfg.meta_verify_token)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Change = { field?: string; value?: Record<string, unknown> & { leadgen_id?: string; form_id?: string; page_id?: string } };
type Payload = { object?: string; entry?: { changes?: Change[] }[] };

export async function POST(request: Request) {
  if (!hasServiceKey()) return Response.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  const cfg = await getConfig();
  // Only Meta knows the app secret: the body must carry its signature.
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  if (!cfg.meta_app_secret || !safeEqual(sig, `sha256=${createHmac("sha256", cfg.meta_app_secret).update(raw).digest("hex")}`)) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const db = createAdminClient();
  const changes = (body.entry ?? []).flatMap((e) => e.changes ?? []);
  const out: unknown[] = [];

  if (body.object === "whatsapp_business_account") {
    for (const c of changes) {
      if (c.field !== "messages" || !c.value) continue;
      const { data, error } = await db.rpc("wa_receive", { p: c.value });
      out.push(error ? { error: error.message } : data);
    }
  }

  if (body.object === "page") {
    const token = cfg.meta_page_token || cfg.wa_token;
    const graph = cfg.wa_api_base || GRAPH;
    for (const c of changes) {
      const v = c.value;
      if (c.field !== "leadgen" || !v?.leadgen_id) continue;
      // The webhook only carries ids; the answers come from the Graph API.
      let lead: Record<string, unknown> | null = null;
      if (token) {
        for (const fields of ["field_data,created_time,ad_name,campaign_name", "field_data,created_time"]) {
          const res = await fetch(`${graph}/${encodeURIComponent(v.leadgen_id)}?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            lead = (await res.json()) as Record<string, unknown>;
            break;
          }
        }
      }
      const { data, error } = await db.rpc("meta_import_lead", {
        p_leadgen: v.leadgen_id,
        p_form: String(v.form_id ?? ""),
        p_page: String(v.page_id ?? ""),
        p_lead: lead,
      });
      out.push(error ? { error: error.message } : { leadgen: v.leadgen_id, result: lead ? data : "no_access" });
    }
  }

  // Always 200 once the signature is good, so Meta doesn't keep retrying the same event.
  return Response.json({ ok: true, results: out });
}
