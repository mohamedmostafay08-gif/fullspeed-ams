"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { setConfig } from "@/lib/app-config";
import { requireRole } from "@/lib/auth";
import { runBackup } from "@/lib/backup";
import { getT } from "@/lib/i18n/server";
import { hasServiceKey } from "@/lib/supabase/admin";
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
    return { ok: t("اتعملت نسخة: {0} سجل · {1}", r.rows, kb(r.bytes)) + drive };
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
  if (!/^\d{6,30}$/.test(phoneId)) return { error: t("Phone number ID لازم يكون أرقام بس") };
  if (!/^[a-z0-9_]{1,512}$/.test(template)) return { error: t("اسم القالب حروف إنجليزي صغيرة وأرقام و _ بس") };
  await Promise.all([
    setConfig("wa_phone_id", phoneId),
    setConfig("wa_template", template),
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
