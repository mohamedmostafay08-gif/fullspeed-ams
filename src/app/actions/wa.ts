"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { getProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/app-config";
import { chatViaLinecrm, sendLinecrmTemplate, sendLinecrmText, type LinecrmSend } from "@/lib/linecrm";
import { sendWhatsAppTemplate, sendWhatsAppText, toWaNumber } from "@/lib/whatsapp-api";

const PHONE_RE = /^\d{8,15}$/;
const DAY = 24 * 3600_000;

/** Who may write to this number: anyone who can see its conversation or its lead (row-level security decides). */
async function access(phone: string) {
  const me = await getProfile();
  if (!me || me.role === "performance" || !PHONE_RE.test(phone)) return null;
  const supabase = await createClient();
  const [{ data: thread }, { data: lead }] = await Promise.all([
    supabase.from("wa_threads").select("phone, last_inbound_at").eq("phone", phone).maybeSingle(),
    supabase.from("leads").select("id, full_name, companies(name)").eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!thread && !lead) return null;
  return { me, thread, lead };
}

/** LineCRM's refusal in words the agent can act on; the code stays visible for support. */
function linecrmError(t: Awaited<ReturnType<typeof getT>>, r: Extract<LinecrmSend, { ok: false }>) {
  if (r.code === "quota_exceeded") return t("رصيد LineCRM للشهر خلص، الإرسال هيرجع أول الشهر. كلّمه في التليفون دلوقتي.");
  if (r.code === "rate_limited") return t("رسايل كتير في دقيقة واحدة، استنى دقيقة وجرّب تاني");
  if (r.code === "insufficient_scope" || r.code === "unauthorized") return t("مفتاح LineCRM مش مسموحله يبعت رسايل — المدير يحط مفتاح فيه messages:write");
  if (r.code === "no_purpose") return t("مفيش قالب متربط في LineCRM لفتح المحادثة — كلّمه في التليفون");
  if (r.code === "send_failed" || r.code === "window_closed") return t("واتساب رفض: غالباً عدّى 24 ساعة من آخر رسالة منه. ({0})", r.error);
  return t("مااتبعتتش: {0}", r.error);
}

export async function sendWaReply(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const phone = String(form.get("phone") ?? "");
  const text = String(form.get("text") ?? "").trim().slice(0, 4000);
  if (!text) return { error: t("اكتب الرسالة") };
  const a = await access(phone);
  if (!a) return { error: t("مش مسموحلك تعمل ده") };
  const cfg = await getConfig();
  if (chatViaLinecrm(cfg)) {
    // LineCRM knows the real 24-hour window (the lead may have written before AMS saw any message).
    const r = await sendLinecrmText(cfg, phone, text);
    if (!r.ok) return { error: linecrmError(t, r) };
    await createAdminClient().rpc("wa_record_out", { p_phone: phone, p_wa_id: r.id ?? null, p_kind: "text", p_body: text, p_user: a.me.id });
    revalidatePath("/", "layout");
    return { ok: t("اتبعتت ✓") };
  }
  const last = a.thread?.last_inbound_at ? Date.parse(a.thread.last_inbound_at) : 0;
  if (Date.now() - last > DAY) return { error: t("عدّى 24 ساعة من آخر رسالة منه — ابعت قالب الترحيب الأول") };
  const r = await sendWhatsAppText(toWaNumber(phone), text);
  if (!r.ok) return { error: t("مااتبعتتش: {0}", r.error) };
  await createAdminClient().rpc("wa_record_out", { p_phone: phone, p_wa_id: r.id ?? null, p_kind: "text", p_body: text, p_user: a.me.id });
  revalidatePath("/", "layout");
  return { ok: t("اتبعتت ✓") };
}

/** Outside the 24-hour window only an approved template may start the conversation again. */
export async function sendWaTemplate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const phone = String(form.get("phone") ?? "");
  const a = await access(phone);
  if (!a) return { error: t("مش مسموحلك تعمل ده") };
  const name = a.lead?.full_name.split(" ")[0] ?? "";
  const company = (a.lead?.companies as unknown as { name: string } | null)?.name ?? "";
  const cfg = await getConfig();
  let r: { ok: true; id?: string } | { ok: false; error: string };
  if (chatViaLinecrm(cfg)) {
    const lc = await sendLinecrmTemplate(cfg, phone, { name, customer_name: name, company, company_name: company });
    if (!lc.ok) return { error: linecrmError(t, lc) };
    r = lc;
  } else {
    r = await sendWhatsAppTemplate(toWaNumber(phone), [name, company]);
  }
  if (!r.ok) return { error: t("مااتبعتتش: {0}", r.error) };
  await createAdminClient().rpc("wa_record_out", { p_phone: phone, p_wa_id: r.id ?? null, p_kind: "template", p_body: t("📨 قالب الترحيب"), p_user: a.me.id });
  revalidatePath("/", "layout");
  return { ok: t("اتبعتت ✓ — لما يرد تقدر تكلمه عادي") };
}

/** A number that wrote in with no lead yet → a lead for the chosen company. */
export async function waMakeLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_make_lead", {
    p_phone: String(form.get("phone") ?? ""),
    p_company: String(form.get("company") ?? ""),
    p_name: String(form.get("name") ?? ""),
  });
  if (error) return { error: /BLACKLISTED/.test(error.message) ? t("الرقم ده في البلاك ليست") : /bad_phone/.test(error.message) ? t("الرقم مش موبايل مصري") : t("حصلت مشكلة، جرّب تاني") };
  revalidatePath("/", "layout");
  return { ok: t("اتعمل ليد واتوزع ✓") };
}

/** How the WhatsApp button behaves: inside AMS (LineCRM number) or the agent's own WhatsApp (wa.me). */
export async function waMode(): Promise<"inapp" | "link"> {
  const cfg = await getConfig();
  return chatViaLinecrm(cfg) ? "inapp" : "link";
}

/** A ready-made message from the WhatsApp button, sent from the company number and saved on the lead. */
export async function sendWaQuick(phone: string, text: string): Promise<ActionState> {
  const form = new FormData();
  form.set("phone", phone);
  form.set("text", text);
  return sendWaReply(undefined, form);
}
