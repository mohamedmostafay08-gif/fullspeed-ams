import { fromDatabase, getConfig } from "@/lib/app-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplate, toWaNumber } from "@/lib/whatsapp-api";

/** New lead → automatic WhatsApp welcome (only when WhatsApp is configured and switched on). */
export async function POST(request: Request) {
  if (!(await fromDatabase(request))) return Response.json({ error: "forbidden" }, { status: 403 });
  const cfg = await getConfig();
  if (cfg.wa_enabled !== "1") return Response.json({ skipped: "disabled" });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const db = createAdminClient();
  const { data: lead } = await db.from("leads").select("id, full_name, phone, companies(name)").eq("id", id ?? "").maybeSingle();
  if (!lead) return Response.json({ skipped: "no lead" });
  const company = (lead.companies as unknown as { name: string } | null)?.name ?? "";
  const res = await sendWhatsAppTemplate(toWaNumber(lead.phone), [lead.full_name.split(" ")[0], company]);
  await db.from("lead_activities").insert({
    lead_id: lead.id,
    note: res.ok ? "🤖 رسالة ترحيب واتساب اتبعتت أوتوماتيك" : `🤖 رسالة الترحيب مااتبعتتش: ${res.error}`.slice(0, 300),
  });
  return Response.json(res);
}
