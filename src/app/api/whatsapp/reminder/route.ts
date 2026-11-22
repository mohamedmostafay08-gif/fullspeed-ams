import { fromDatabase, getConfig } from "@/lib/app-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { cairoDateTime } from "@/lib/time";
import { sendWhatsAppTemplate, toWaNumber } from "@/lib/whatsapp-api";

/** Interview tomorrow / in an hour → WhatsApp reminder to the captain (queued by the database scheduler). */
export async function POST(request: Request) {
  if (!(await fromDatabase(request))) return Response.json({ error: "forbidden" }, { status: 403 });
  const cfg = await getConfig();
  if (cfg.wa_enabled !== "1" || !cfg.wa_reminder_template) return Response.json({ skipped: "disabled" });
  const { id, kind } = (await request.json().catch(() => ({}))) as { id?: string; kind?: "day" | "hour" };
  const db = createAdminClient();
  const { data: lead } = await db
    .from("leads")
    .select("id, full_name, phone, status, interview_at, interview_place, companies(name)")
    .eq("id", id ?? "")
    .maybeSingle();
  if (!lead || lead.status !== "interview" || !lead.interview_at) return Response.json({ skipped: "no interview" });
  const company = (lead.companies as unknown as { name: string } | null)?.name ?? "";
  const res = await sendWhatsAppTemplate(
    toWaNumber(lead.phone),
    [lead.full_name.split(" ")[0], company, cairoDateTime(lead.interview_at, "ar"), lead.interview_place || company],
    "wa_reminder_template",
  );
  const when = kind === "hour" ? "قبل المقابلة بساعة" : "قبل المقابلة بيوم";
  await db.from("lead_activities").insert({
    lead_id: lead.id,
    note: res.ok ? `🤖 تذكير المقابلة اتبعت واتساب (${when})` : `🤖 تذكير المقابلة مااتبعتش: ${res.error}`.slice(0, 300),
  });
  return Response.json(res);
}
