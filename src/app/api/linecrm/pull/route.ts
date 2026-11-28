import { fromDatabase, getConfig, setConfig } from "@/lib/app-config";
import { LINECRM_API, linecrmBackoffActive } from "@/lib/linecrm";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pulls LineCRM's lead list in pages (called every 15 minutes by the database scheduler).
 * One request brings many leads, so the monthly quota (10,000) covers ~1,100 leads a day.
 * The page text goes to Postgres as-is (linecrm_store_bulk): parsing and matching happen there,
 * which keeps this request inside Cloudflare's 10 ms CPU budget.
 *
 * Each run reads page 1 (newest leads), then up to 3 more pages of the backlog, resuming from
 * `linecrm_pull_page`. The list query is a setting (`linecrm_list_query`, `{page}` is replaced)
 * so it can be tuned to LineCRM's API without a deploy.
 */
const BACKLOG_PAGES = 3;
const DEFAULT_QUERY = "per_page=100&page={page}";

type Bulk = { leads?: number; matched?: number; oldest?: string | null; need_more?: boolean; error?: string };

export async function POST(request: Request) {
  if (!(await fromDatabase(request))) return Response.json({ error: "forbidden" }, { status: 403 });
  const cfg = await getConfig();
  if (!cfg.linecrm_api_key) return Response.json({ skipped: "no api key" });
  if (linecrmBackoffActive(cfg)) return Response.json({ skipped: "backoff" });

  const db = createAdminClient();
  const query = cfg.linecrm_list_query || DEFAULT_QUERY;
  const cursor = Math.max(2, Number(cfg.linecrm_pull_page) || 2);
  const pages = [1, ...Array.from({ length: BACKLOG_PAGES }, (_, i) => cursor + i)];

  const log: unknown[] = [];
  let next = cursor;
  let limited = false;
  for (const page of pages) {
    let res: Response;
    try {
      res = await fetch(`${LINECRM_API}/leads?${query.replaceAll("{page}", String(page))}`, {
        headers: { Authorization: `Bearer ${cfg.linecrm_api_key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      log.push({ page, error: e instanceof Error ? e.message.slice(0, 200) : "fetch failed" });
      break;
    }
    const text = await res.text();
    if (res.status === 429) {
      limited = true;
      log.push({ page, error: "HTTP 429", body: text.slice(0, 200) });
      break;
    }
    if (!res.ok) {
      log.push({ page, error: `HTTP ${res.status}`, body: text.slice(0, 200) });
      break;
    }
    const { data, error } = await db.rpc("linecrm_store_bulk", { p_body: text });
    if (error) {
      log.push({ page, error: error.message });
      break;
    }
    const r = (data ?? {}) as Bulk;
    log.push({ page, ...r });
    if (r.error) break;
    if (page === 1) {
      // Page 1 already reaches the oldest waiting lead: no backlog to walk.
      if (!r.need_more) {
        next = 2;
        break;
      }
      continue;
    }
    if (!r.need_more || !r.leads) {
      next = 2; // backlog done: start over from the newest pages next time
      break;
    }
    next = page + 1;
  }

  await db.rpc("linecrm_rate_state", { p_limited: limited });
  await setConfig("linecrm_pull_page", String(next));
  await setConfig("linecrm_pull_last", JSON.stringify({ at: new Date().toISOString(), log }).slice(0, 4000));
  return Response.json({ next, log });
}
