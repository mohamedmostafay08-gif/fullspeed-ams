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

export type LinecrmSend = { ok: true; id?: string } | { ok: false; code: string; error: string };

/**
 * Sends from LineCRM's WhatsApp number (the one the lead already wrote to).
 * Each send is one request of LineCRM's monthly allowance; incoming and outgoing messages
 * come back through the webhook (message.received / message.sent) for free.
 * `linecrm_send_key` is a key with messages:write; the read-only lead key is used if it's missing.
 */
async function linecrmPost(cfg: Record<string, string>, path: string, body: Record<string, unknown>): Promise<LinecrmSend> {
  const key = cfg.linecrm_send_key || cfg.linecrm_api_key;
  if (!key) return { ok: false, code: "not_configured", error: "not configured" };
  try {
    const res = await fetch(`${LINECRM_API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let out: Record<string, unknown> = {};
    try {
      out = JSON.parse(text) as Record<string, unknown>;
    } catch {}
    if (res.ok) {
      const data = (out.data ?? out) as Record<string, unknown>;
      const id = data.wamid ?? data.message_id ?? data.id;
      return { ok: true, id: typeof id === "string" || typeof id === "number" ? String(id) : undefined };
    }
    const err = (typeof out.error === "object" && out.error ? out.error : out) as Record<string, unknown>;
    const code = String(err.code ?? (typeof out.error === "string" ? out.error : "") ?? "") || `HTTP ${res.status}`;
    const message = String(err.message ?? out.message ?? text.slice(0, 200) ?? "");
    return { ok: false, code, error: `${code}${message && message !== code ? `: ${message}` : ""}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, code: "network_error", error: e instanceof Error ? e.message.slice(0, 200) : "fetch failed" };
  }
}

/** Egyptian mobile (01…) → +201… */
const intl = (phone: string) => (phone.startsWith("0") ? `+2${phone}` : phone.startsWith("+") ? phone : `+${phone}`);

/** Free text. LineCRM refuses it outside WhatsApp's 24-hour window (send_failed / window_closed). */
export function sendLinecrmText(cfg: Record<string, string>, phone: string, text: string) {
  return linecrmPost(cfg, "/messages", {
    channel: "whatsapp",
    ...(cfg.linecrm_wa_account ? { account_id: cfg.linecrm_wa_account } : {}),
    to: intl(phone),
    text,
  });
}

/** Approved template by purpose (bound once in LineCRM): reopens a conversation after 24 hours. */
export function sendLinecrmTemplate(cfg: Record<string, string>, phone: string, vars: Record<string, string>) {
  if (!cfg.linecrm_wa_purpose) return Promise.resolve<LinecrmSend>({ ok: false, code: "no_purpose", error: "no purpose" });
  return linecrmPost(cfg, "/messages/template", { to: intl(phone), purpose: cfg.linecrm_wa_purpose, variables: vars });
}

/** Chat goes through LineCRM's number instead of a Meta Cloud API number of our own. */
export const chatViaLinecrm = (cfg: Record<string, string>) => cfg.wa_provider === "linecrm";
