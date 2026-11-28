import "server-only";

export const LINECRM_API = "https://linecrm.app/api/v1";

/** lead.created carries no phone: read the full lead from LineCRM with the read-only key. */
export async function fetchLinecrmLead(leadId: string, key: string): Promise<{ details: unknown; error: string | null }> {
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

/** True while LineCRM is rate-limiting us (set by linecrm_rate_state after an HTTP 429). */
export function linecrmBackoffActive(cfg: Record<string, string>) {
  const until = Date.parse(cfg.linecrm_backoff_until ?? "");
  return Number.isFinite(until) && until > Date.now();
}
