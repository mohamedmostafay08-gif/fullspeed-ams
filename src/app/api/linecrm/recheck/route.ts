import { fromDatabase, getConfig } from "@/lib/app-config";
import { fetchLinecrmLead, linecrmBackoffActive } from "@/lib/linecrm";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Re-reads LineCRM leads at a steady pace (called every minute by the database scheduler):
 * leads whose first read failed (e.g. HTTP 429) and leads still waiting for a phone.
 * Stops at the first 429 and pauses for 2 minutes, so we never hammer LineCRM.
 * Kept small: each lead costs 2–3 subrequests and Cloudflare's free plan allows 50 per request.
 */
const BATCH = 10;

export async function POST(request: Request) {
  if (!(await fromDatabase(request))) return Response.json({ error: "forbidden" }, { status: 403 });
  const cfg = await getConfig();
  if (!cfg.linecrm_api_key) return Response.json({ skipped: "no api key" });
  if (linecrmBackoffActive(cfg)) return Response.json({ skipped: "backoff" });

  const db = createAdminClient();
  const { data: due, error } = await db.rpc("linecrm_recheck_list", { p_limit: BATCH });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let read = 0;
  let limited = false;
  for (const r of (due ?? []) as { id: string; lead_id: string }[]) {
    const { details, error: detailError } = await fetchLinecrmLead(r.lead_id, cfg.linecrm_api_key);
    await db.rpc("linecrm_store_details", { p_event: r.id, p_details: detailError ? null : details, p_error: detailError });
    if (detailError === "HTTP 429") {
      limited = true;
      break;
    }
    read++;
  }
  // One call either way: sets the pause on a 429, clears it after a clean run.
  if (limited || cfg.linecrm_backoff_until || cfg.linecrm_429_since) await db.rpc("linecrm_rate_state", { p_limited: limited });
  return Response.json({ read, limited });
}
