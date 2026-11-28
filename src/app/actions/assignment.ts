"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { MANAGERS, STAFF, requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { RULE_FIELDS } from "@/lib/status-rules";
import { LEAD_STATUS_LABELS } from "@/lib/types";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const int = (form: FormData, key: string) => {
  const v = str(form, key);
  return v === "" ? 0 : Number(v);
};
const PAGE = "/admin/distribution";

/** Distribution rules: skip unavailable agents, default cap on open leads, and the follow-up timeout. */
export async function saveAssignmentSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const online = int(form, "online_minutes");
  const cap = int(form, "max_open_default");
  const timeout = int(form, "reassign_minutes");
  const times = int(form, "max_reassigns") || 1;
  if (!Number.isInteger(online) || online < 0 || online > 600) return { error: t("مدة «فاتح السيستم» لازم تكون من 0 لـ 600 دقيقة") };
  if (!Number.isInteger(cap) || cap < 0 || cap > 10000) return { error: t("الحد الأقصى لازم يكون رقم من 0 لـ 10000") };
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 1440) return { error: t("المهلة لازم تكون من 0 لـ 1440 دقيقة") };
  if (!Number.isInteger(times) || times < 1 || times > 5) return { error: t("عدد مرات التحويل من 1 لـ 5") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("assignment_settings")
    .update({
      skip_unavailable: form.get("skip_unavailable") === "on",
      online_minutes: online,
      max_open_default: cap,
      reassign_minutes: timeout,
      max_reassigns: times,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { error: t("مقدرتش أحفظ: {0}", error.message) };
  revalidatePath(PAGE);
  return { ok: t("تم الحفظ") };
}

/** One agent: receives new leads or not, and their own cap (empty = the default). */
export async function saveAgentReceiving(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...STAFF);
  const agent = str(form, "agent_id");
  const maxRaw = str(form, "max_open");
  const max = maxRaw === "" ? null : Number(maxRaw);
  if (!/^[0-9a-f-]{36}$/i.test(agent)) return { error: t("حصلت مشكلة، جرّب تاني") };
  if (max !== null && (!Number.isInteger(max) || max < 0 || max > 10000)) return { error: t("الحد الأقصى لازم يكون رقم من 0 لـ 10000") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_agent_receiving", { p_agent: agent, p_on: form.get("receives") === "on", p_max: max });
  if (error) return { error: /FORBIDDEN/.test(error.message) ? t("مش مسموحلك تعمل ده") : t("مقدرتش أحفظ: {0}", error.message) };
  revalidatePath(PAGE);
  return { ok: t("تم الحفظ") };
}

/** One status rule: fields required before a lead enters it, and how many hours it may stay (empty = no limit). */
export async function saveStatusRule(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const status = str(form, "status");
  if (!Object.hasOwn(LEAD_STATUS_LABELS, status)) return { error: t("حصلت مشكلة، جرّب تاني") };
  const required = form.getAll("required").map(String).filter((f) => Object.hasOwn(RULE_FIELDS, f));
  const hoursRaw = str(form, "max_hours");
  const hours = hoursRaw === "" || hoursRaw === "0" ? null : Number(hoursRaw);
  if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 2160)) return { error: t("المدة من 1 لـ 2160 ساعة") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_status_rule", { p_status: status, p_required: required, p_max_hours: hours });
  if (error) return { error: /FORBIDDEN/.test(error.message) ? t("مش مسموحلك تعمل ده") : t("مقدرتش أحفظ: {0}", error.message) };
  revalidatePath(PAGE);
  return { ok: t("تم الحفظ") };
}

/** «وزّع»: hands one company's (or every company's) unassigned leads to its agents, evenly, in one DB call (0054). */
export async function distributeUnassigned(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const company = str(form, "company_id");
  if (company && !/^[0-9a-f-]{36}$/i.test(company)) return { error: t("بيانات غلط — اعمل refresh وجرّب تاني") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distribute_unassigned", { p_company: company || null, p_limit: 5000 });
  if (error) {
    if (error.code === "PGRST202" || error.message.includes("distribute_unassigned")) return { error: t("لازم migration 0054 تتطبق في Supabase الأول") };
    return { error: /FORBIDDEN/.test(error.message) ? t("مش مسموحلك تعمل ده") : error.message };
  }
  revalidatePath("/admin", "layout");
  const n = Number(data ?? 0);
  return n > 0 ? { ok: t("اتوزّع {0} ليد ✓", n) } : { error: t("مفيش ليدز اتوزعت — اربط أجنتس بالشركة الأول") };
}

/** Evens out one company's untouched leads across its linked agents — all of them, or only one agent's surplus. */
export async function rebalanceCompanyLeads(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const company = str(form, "company_id");
  const from = str(form, "from_agent");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(company) || (from && !uuid.test(from))) return { error: t("بيانات غلط — اعمل refresh وجرّب تاني") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rebalance_company_leads", { p_company: company, p_from: from || null });
  if (error) {
    if (error.code === "PGRST202" || error.message.includes("rebalance_company_leads")) return { error: t("لازم migration 0057 تتطبق في Supabase الأول") };
    return { error: /FORBIDDEN/.test(error.message) ? t("مش مسموحلك تعمل ده") : error.message };
  }
  revalidatePath("/admin", "layout");
  const n = Number(data ?? 0);
  return n > 0 ? { ok: t("اتنقل {0} ليد ✓ — اللي فوق الحد الأقصى للأجنتس رجع «مش متوزعة».", n) } : { ok: t("التوزيع متساوي أصلاً — مفيش حاجة اتنقلت") };
}
