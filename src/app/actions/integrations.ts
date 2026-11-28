"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { setConfig } from "@/lib/app-config";
import { requireRole } from "@/lib/auth";
import { runBackup } from "@/lib/backup";
import { getT } from "@/lib/i18n/server";
import { hasServiceKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone, isValidEgyptMobile } from "@/lib/forms";
import { sendWhatsAppTemplate, toWaNumber } from "@/lib/whatsapp-api";

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export async function backupNow(): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  if (!hasServiceKey()) return { error: t("حصلت مشكلة، جرّب تاني") };
  try {
    const r = await runBackup({ withDrive: true });
    revalidatePath("/admin/integrations");
    const drive = r.drive === "ok" ? t(" · واتبعتت لـ Google Drive ✓") : r.drive === "error" ? t(" · Google Drive: {0}", r.driveError ?? "") : "";
    return { ok: t("اتعملت نسخة: {0}", kb(r.bytes)) + drive };
  } catch (e) {
    return { error: t("النسخة فشلت: {0}", e instanceof Error ? e.message : "") };
  }
}

export async function saveDriveUrl(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const url = String(form.get("url") ?? "").trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return { error: t("الرابط لازم يكون رابط Web app من Google Apps Script وبينتهي بـ /exec") };
  await setConfig("drive_script_url", url);
  revalidatePath("/admin/integrations");
  return { ok: url ? t("اتحفظ — جرّب «اعمل نسخة دلوقتي»") : t("اتشال الربط بـ Google Drive") };
}

export async function saveWhatsApp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const phoneId = String(form.get("phone_id") ?? "").trim();
  const template = String(form.get("template") ?? "").trim();
  const lang = String(form.get("lang") ?? "ar").trim() || "ar";
  const token = String(form.get("token") ?? "").trim();
  const reminder = String(form.get("reminder_template") ?? "").trim();
  if (!/^\d{6,30}$/.test(phoneId)) return { error: t("Phone number ID لازم يكون أرقام بس") };
  if (!/^[a-z0-9_]{1,512}$/.test(template)) return { error: t("اسم القالب حروف إنجليزي صغيرة وأرقام و _ بس") };
  if (reminder && !/^[a-z0-9_]{1,512}$/.test(reminder)) return { error: t("اسم القالب حروف إنجليزي صغيرة وأرقام و _ بس") };
  await Promise.all([
    setConfig("wa_phone_id", phoneId),
    setConfig("wa_template", template),
    setConfig("wa_reminder_template", reminder),
    setConfig("wa_lang", lang),
    setConfig("wa_enabled", form.get("enabled") === "on" ? "1" : "0"),
    ...(token ? [setConfig("wa_token", token)] : []),
  ]);
  revalidatePath("/admin/integrations");
  return { ok: t("تم الحفظ") };
}

export async function testWhatsApp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (!isValidEgyptMobile(phone)) return { error: t("رقم الموبايل غير صحيح (لازم 11 رقم ويبدأ بـ 01)") };
  const r = await sendWhatsAppTemplate(toWaNumber(phone), ["Full Speed", "Full Speed"]);
  return r.ok ? { ok: t("اتبعتت ✓ — شوف الواتساب على الرقم ده") } : { error: t("مااتبعتتش: {0}", r.error) };
}

// ───────── LineCRM event notifications ─────────
export async function saveLineCrm(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const secret = String(form.get("secret") ?? "").trim();
  if (secret.length < 16 || secret.length > 300 || /\s/.test(secret)) return { error: t("الـ secret شكله مش مظبوط — انسخه تاني من LineCRM") };
  await setConfig("linecrm_webhook_secret", secret);
  revalidatePath("/admin/integrations");
  return { ok: t("تم الحفظ") };
}

export async function saveLineCrmKey(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const key = String(form.get("api_key") ?? "").trim();
  if (key.length < 16 || key.length > 300 || /\s/.test(key)) return { error: t("المفتاح شكله مش مظبوط — انسخه تاني من LineCRM") };
  await setConfig("linecrm_api_key", key);
  revalidatePath("/admin/integrations");
  return { ok: t("تم الحفظ") };
}

/** WhatsApp chat from inside AMS through LineCRM's number (the one the leads already wrote to). */
export async function saveLineCrmChat(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const key = String(form.get("send_key") ?? "").trim();
  const account = String(form.get("account") ?? "").trim();
  const purpose = String(form.get("purpose") ?? "").trim();
  const chatSecret = String(form.get("chat_secret") ?? "").trim();
  if (chatSecret && (chatSecret.length < 16 || chatSecret.length > 300 || /\s/.test(chatSecret))) return { error: t("الـ secret شكله مش مظبوط — انسخه تاني من LineCRM") };
  if (key && (key.length < 16 || key.length > 300 || /\s/.test(key))) return { error: t("المفتاح شكله مش مظبوط — انسخه تاني من LineCRM") };
  if (account.length > 100 || /\s/.test(account)) return { error: t("رقم الحساب المربوط شكله مش مظبوط") };
  if (purpose.length > 100 || /\s/.test(purpose)) return { error: t("اسم الغرض (purpose) من غير مسافات") };
  await Promise.all([
    setConfig("wa_provider", form.get("enabled") === "on" ? "linecrm" : "meta"),
    key ? setConfig("linecrm_send_key", key) : Promise.resolve(),
    chatSecret ? setConfig("linecrm_chat_secret", chatSecret) : Promise.resolve(),
    setConfig("linecrm_wa_account", account),
    setConfig("linecrm_wa_purpose", purpose),
  ]);
  revalidatePath("/", "layout");
  return { ok: t("تم الحفظ") };
}

// ───────── Meta: WhatsApp inbox + Facebook lead ads ─────────
export async function saveMeta(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  const secret = String(form.get("app_secret") ?? "").trim();
  const pageToken = String(form.get("page_token") ?? "").trim();
  const company = String(form.get("inbox_company") ?? "").trim();
  if (secret && !/^[a-f0-9]{32}$/i.test(secret)) return { error: t("App secret بيبقى 32 حرف ورقم (a-f و 0-9)") };
  if (company && !/^[0-9a-f-]{36}$/i.test(company)) return { error: t("اختار الشركة") };
  await Promise.all([
    setConfig("wa_inbox_company", company),
    setConfig("wa_auto_lead", form.get("auto_lead") === "on" ? "1" : "0"),
    ...(secret ? [setConfig("meta_app_secret", secret)] : []),
    ...(pageToken ? [setConfig("meta_page_token", pageToken)] : []),
  ]);
  revalidatePath("/admin/integrations");
  return { ok: t("تم الحفظ") };
}

export async function addLeadForm(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin", "manager");
  const formId = String(form.get("form_id") ?? "").trim();
  const company = String(form.get("company_id") ?? "");
  if (!/^\d{5,30}$/.test(formId)) return { error: t("رقم الفورم أرقام بس (من Meta Business Suite ← الفورمز)") };
  const supabase = await createClient();
  const { error } = await supabase.from("meta_lead_forms").upsert({ form_id: formId, company_id: company, name: String(form.get("name") ?? "").trim().slice(0, 80) || null });
  if (error) return { error: `${t("مقدرتش أحفظ")}: ${error.message}` };
  // Leads that arrived before the form was linked come in now.
  const { data: n } = await supabase.rpc("meta_retry_unmapped");
  revalidatePath("/admin/integrations");
  return { ok: n ? t("اتربط ✓ ودخل {0} ليد كانوا مستنيين", n) : t("اتربط ✓") };
}

export async function deleteLeadForm(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin", "manager");
  const supabase = await createClient();
  const { data, error } = await supabase.from("meta_lead_forms").delete().eq("form_id", String(form.get("form_id") ?? "")).select("form_id");
  if (error) return { error: `مقدرتش أمسح الفورم: ${error.message}` };
  if (!data?.length) return { error: "الفورم مش موجود أو مش مسموحلك تمسحه" };
  revalidatePath("/admin/integrations");
  return { ok: "اتمسح ✓" };
}

/** «ليدز فيسبوك»: one waiting lead from an unlinked form → the company picked for it. */
export async function assignFacebookLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin", "manager");
  const leadgen = String(form.get("leadgen_id") ?? "");
  const company = String(form.get("company_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(company)) return { error: t("اختار الشركة") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meta_assign_lead", { p_leadgen: leadgen, p_company: company });
  if (error) return { error: `${t("مقدرتش أحفظ")}: ${error.message}` };
  revalidatePath("/admin/facebook-leads");
  const RESULT: Record<string, ActionState> = {
    created: { ok: t("✅ دخل على الشركة واتوزع") },
    duplicate: { error: t("♻️ الرقم ده موجود قبل كده في الشركة دي") },
    invalid: { error: t("❌ الاسم أو الرقم ناقص أو غلط") },
    blacklisted: { error: t("⛔ الرقم ده في البلاك ليست") },
    gone: { error: t("الليد ده اتوزع قبل كده") },
    no_company: { error: t("اختار الشركة") },
  };
  return RESULT[String(data)] ?? { error: t("⚠️ مشكلة") };
}

export async function dismissFacebookLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin", "manager");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meta_dismiss_lead", { p_leadgen: String(form.get("leadgen_id") ?? "") });
  if (error) return { error: `مقدرتش أشيله: ${error.message}` };
  if (!data) return { error: "الليد ده اتوزع أو اتشال قبل كده" };
  revalidatePath("/admin/facebook-leads");
  return { ok: "اتشال ✓" };
}

/** «ليدز للتوزيع»: one waiting LineCRM lead (WhatsApp ads) → the company picked for it. */
export async function assignLineCrmLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin", "manager");
  const event = String(form.get("event_id") ?? "");
  const company = String(form.get("company_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(company)) return { error: t("اختار الشركة") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("linecrm_assign_lead", { p_event: event, p_company: company });
  if (error) return { error: `${t("مقدرتش أحفظ")}: ${error.message}` };
  revalidatePath("/admin/facebook-leads");
  const RESULT: Record<string, ActionState> = {
    created: { ok: t("✅ دخل على الشركة واتوزع") },
    duplicate: { error: t("♻️ الرقم ده موجود قبل كده في الشركة دي") },
    invalid: { error: t("❌ الاسم أو الرقم ناقص أو غلط") },
    blacklisted: { error: t("⛔ الرقم ده في البلاك ليست") },
    gone: { error: t("الليد ده اتوزع قبل كده") },
    no_company: { error: t("اختار الشركة") },
  };
  return RESULT[String(data)] ?? { error: t("⚠️ مشكلة") };
}

export async function dismissLineCrmLead(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin", "manager");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("linecrm_dismiss_lead", { p_event: String(form.get("event_id") ?? "") });
  if (error) return { error: `مقدرتش أشيله: ${error.message}` };
  if (!data) return { error: "الليد ده اتوزع أو اتشال قبل كده" };
  revalidatePath("/admin/facebook-leads");
  return { ok: "اتشال ✓" };
}

/** «ليدز للتوزيع»: every waiting LineCRM lead of one campaign → one company. */
export async function assignLineCrmMany(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin", "manager");
  const company = String(form.get("company_id") ?? "");
  const events = String(form.get("event_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(company)) return { error: t("اختار الشركة") };
  if (events.length === 0) return { error: t("مفيش ليدز") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("linecrm_assign_many", { p_events: events, p_company: company });
  if (error) return { error: `${t("مقدرتش أحفظ")}: ${error.message}` };
  revalidatePath("/admin/facebook-leads");
  const c = (data ?? {}) as Record<string, number>;
  const parts = [
    c.created && t("✅ {0} دخلوا واتوزعوا", c.created),
    c.duplicate && t("♻️ {0} مكررين", c.duplicate),
    c.invalid && t("❌ {0} بياناتهم ناقصة", c.invalid),
    c.blacklisted && t("⛔ {0} في البلاك ليست", c.blacklisted),
    c.gone && t("{0} اتوزعوا قبل كده", c.gone),
  ].filter(Boolean);
  return c.created ? { ok: parts.join(" · ") } : { error: parts.join(" · ") || t("⚠️ مشكلة") };
}

/** Auto-assign switch: a lead whose campaign or ad names exactly one company goes straight to it. */
export async function saveAutoAssign(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin");
  await setConfig("auto_assign_by_campaign", form.get("enabled") === "on" ? "1" : "0");
  revalidatePath("/admin/facebook-leads");
  return { ok: t("تم الحفظ") };
}

export async function addCompanyKeyword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("admin", "manager");
  const company = String(form.get("company_id") ?? "");
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 60);
  if (!/^[0-9a-f-]{36}$/i.test(company)) return { error: t("اختار الشركة") };
  if (keyword.length < 2) return { error: t("الكلمة لازم تبقى حرفين على الأقل") };
  const supabase = await createClient();
  const { error } = await supabase.from("company_keywords").insert({ company_id: company, keyword });
  if (error) return { error: error.code === "23505" ? t("الكلمة دي موجودة للشركة دي") : `${t("مقدرتش أحفظ")}: ${error.message}` };
  revalidatePath("/admin/facebook-leads");
  return { ok: t("اتضافت ✓") };
}

export async function deleteCompanyKeyword(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireRole("admin", "manager");
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_keywords").delete().eq("id", String(form.get("id") ?? "")).select("id");
  if (error) return { error: `مقدرتش أمسح الكلمة: ${error.message}` };
  if (!data?.length) return { error: "الكلمة مش موجودة أو مش مسموحلك تمسحها" };
  revalidatePath("/admin/facebook-leads");
  return { ok: "اتمسحت ✓" };
}
