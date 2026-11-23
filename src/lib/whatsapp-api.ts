import "server-only";
import { getConfig } from "@/lib/app-config";

export type WaResult = { ok: true; id?: string } | { ok: false; error: string };

/** Sends an approved WhatsApp template through the WhatsApp Cloud API (Meta). */
export async function sendWhatsAppTemplate(to: string, params: string[], templateKey: "wa_template" | "wa_reminder_template" = "wa_template"): Promise<WaResult> {
  const cfg = await getConfig();
  const template = cfg[templateKey];
  if (cfg.wa_enabled !== "1" || !cfg.wa_phone_id || !cfg.wa_token || !template) return { ok: false, error: "not configured" };
  const base = cfg.wa_api_base || "https://graph.facebook.com/v21.0";
  const res = await fetch(`${base}/${encodeURIComponent(cfg.wa_phone_id)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.wa_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: cfg.wa_lang || "ar" },
        components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [],
      },
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  return res.ok ? { ok: true, id: out.messages?.[0]?.id } : { ok: false, error: out.error?.message ?? `HTTP ${res.status}` };
}

/** Egyptian mobile (01xxxxxxxxx) → international format WhatsApp expects (201xxxxxxxxx). */
export const toWaNumber = (phone: string) => (phone.startsWith("0") ? `2${phone}` : phone);

/** Free-form text reply. WhatsApp only allows it within 24 hours of the person's last message. */
export async function sendWhatsAppText(to: string, text: string): Promise<WaResult> {
  const cfg = await getConfig();
  if (!cfg.wa_phone_id || !cfg.wa_token) return { ok: false, error: "not configured" };
  const base = cfg.wa_api_base || "https://graph.facebook.com/v21.0";
  const res = await fetch(`${base}/${encodeURIComponent(cfg.wa_phone_id)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.wa_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } }),
  });
  const out = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  return res.ok ? { ok: true, id: out.messages?.[0]?.id } : { ok: false, error: out.error?.message ?? `HTTP ${res.status}` };
}
