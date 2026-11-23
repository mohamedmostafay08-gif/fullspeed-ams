import { getConfig } from "@/lib/app-config";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** A photo or file someone sent on WhatsApp, fetched from Meta for people allowed to see that conversation. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me || !/^\d{5,30}$/.test(id)) return new Response("not found", { status: 404 });
  // Row-level security: the message (and so the media) must belong to a conversation this person can see.
  const supabase = await createClient();
  const { data: msg } = await supabase.from("wa_messages").select("id").eq("media_id", id).limit(1).maybeSingle();
  if (!msg) return new Response("not found", { status: 404 });
  const cfg = await getConfig();
  if (!cfg.wa_token) return new Response("not configured", { status: 503 });
  const base = cfg.wa_api_base || "https://graph.facebook.com/v21.0";
  const meta = await fetch(`${base}/${id}`, { headers: { Authorization: `Bearer ${cfg.wa_token}` } });
  if (!meta.ok) return new Response("expired", { status: 410 });
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) return new Response("expired", { status: 410 });
  const file = await fetch(url, { headers: { Authorization: `Bearer ${cfg.wa_token}` } });
  if (!file.ok || !file.body) return new Response("expired", { status: 410 });
  return new Response(file.body, {
    headers: { "Content-Type": mime_type ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
