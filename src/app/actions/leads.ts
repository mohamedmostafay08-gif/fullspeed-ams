"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isValidEgyptMobile, normalizePhone, readCustomFields } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import type { FormField, LeadStatus } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { cairoLocalToIso } from "@/lib/time";

export type LeadFormState = { error?: string; duplicateOf?: string } | undefined;

const STATUSES: LeadStatus[] = ["new", "no_answer", "contacted", "interview", "documents", "hired", "rejected"];

export async function createLead(_prev: LeadFormState, form: FormData): Promise<LeadFormState> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  const companyId = String(form.get("company_id") ?? "");
  const { data: company } = await supabase.from("companies").select("id, form_schema, is_active").eq("id", companyId).single();
  if (!company?.is_active) return { error: t("اختار شركة") };

  const fullName = String(form.get("full_name") ?? "").trim();
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (fullName.length < 3) return { error: t("اكتب اسم المتقدم كامل") };
  if (!isValidEgyptMobile(phone)) return { error: t("رقم الموبايل غير صحيح (لازم 11 رقم ويبدأ بـ 01)") };

  const { data: custom, errors } = readCustomFields(company.form_schema as FormField[], form);
  if (errors.length) return { error: errors.join(" · ") };

  const { data: banned } = await supabase.rpc("blacklist_reason", { p_phone: phone });
  if (banned) return { error: t("الرقم ده في البلاك ليست — {0}", banned) };

  if (form.get("allow_duplicate") !== "1") {
    const { data: taken } = await supabase.rpc("lead_phone_taken", { p_company: companyId, p_phone: phone });
    if (taken) return { error: t("الرقم ده متسجل قبل كده على نفس الشركة"), duplicateOf: "1" };
  }

  const staff = profile.role !== "agent";
  const chosenAgent = String(form.get("agent_id") ?? "");
  const governorate = Number(form.get("governorate_id")) || null;
  const region = Number(form.get("region_id")) || null;

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      company_id: companyId,
      agent_id: staff ? chosenAgent || null : profile.id,
      full_name: fullName,
      phone,
      governorate_id: governorate,
      region_id: region,
      form_data: custom,
      notes: String(form.get("notes") ?? "").trim() || null,
      source: String(form.get("source") ?? "manual").slice(0, 40) || "manual",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("BLACKLISTED")) return { error: t("الرقم ده في البلاك ليست — {0}", "") };
    return { error: t("مقدرتش أحفظ الليد — اتأكد إنك متعين على الشركة دي") };
  }

  revalidatePath("/", "layout");
  redirect(staff ? `/admin/leads/${lead.id}` : `/agent/leads/${lead.id}`);
}

export async function updateLead(form: FormData) {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const id = String(form.get("id"));
  const patch: Record<string, unknown> = {};

  const status = form.get("status") as LeadStatus | null;
  if (status && STATUSES.includes(status)) patch.status = status;
  if (form.has("notes")) patch.notes = String(form.get("notes")).trim() || null;
  if (profile.role !== "agent" && form.has("agent_id")) patch.agent_id = String(form.get("agent_id")) || null;

  if (Object.keys(patch).length) {
    const { error } = await supabase.from("leads").update(patch).eq("id", id);
    if (error) throw new Error(t("مقدرتش أعدل الليد"));
  }
  revalidatePath("/", "layout");
}

// ───────── Calling workflow ─────────
export type CallOutcome = "answered" | "no_answer" | "callback" | "interview" | "rejected" | "hired";
export type CallResult = { error?: string; ok?: boolean };

/** Activity-log lines (Arabic keys; translated when shown). */
const OUTCOME_NOTE: Record<CallOutcome, string> = {
  answered: "📞 رد واتكلمنا",
  no_answer: "📵 مردش",
  callback: "⏰ طلب نكلمه بعدين",
  interview: "📅 اتحدد معاد مقابلة",
  rejected: "✋ رفض / مش مناسب",
  hired: "🎉 اشتغل",
};
const OPEN: LeadStatus[] = ["new", "no_answer"];

function futureIso(local: string | null): string | null {
  const iso = local ? cairoLocalToIso(local) : null;
  return iso && new Date(iso).getTime() > Date.now() - 5 * 60_000 ? iso : null;
}

/** One call attempt: bumps attempts, moves the status and (re)schedules. */
export async function recordCall(form: FormData): Promise<CallResult> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const id = String(form.get("id") ?? "");
  const outcome = String(form.get("outcome") ?? "") as CallOutcome;
  if (!(outcome in OUTCOME_NOTE)) return { error: t("حصلت مشكلة، جرّب تاني") };

  const { data: lead } = await supabase.from("leads").select("id, status, attempts").eq("id", id).maybeSingle();
  if (!lead) return { error: t("مقدرتش أعدل الليد") };
  const status = lead.status as LeadStatus;
  const patch: Record<string, unknown> = { attempts: lead.attempts + 1, last_contact_at: new Date().toISOString(), callback_at: null };

  if (outcome === "answered" && OPEN.includes(status)) patch.status = "contacted";
  if (outcome === "no_answer" && OPEN.includes(status)) patch.status = "no_answer";
  if (outcome === "callback") {
    const at = futureIso(String(form.get("at") ?? ""));
    if (!at) return { error: t("اختار معاد صحيح في المستقبل") };
    patch.callback_at = at;
    if (OPEN.includes(status)) patch.status = "contacted";
  }
  if (outcome === "interview") {
    const at = futureIso(String(form.get("at") ?? ""));
    if (!at) return { error: t("اختار معاد صحيح في المستقبل") };
    patch.status = "interview";
    patch.interview_at = at;
    patch.interview_place = String(form.get("place") ?? "").trim().slice(0, 200) || null;
  }
  if (outcome === "rejected") patch.status = "rejected";
  if (outcome === "hired") patch.status = "hired";

  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) return { error: t("مقدرتش أعدل الليد") };
  await supabase.rpc("log_lead_note", { p_lead: id, p_note: OUTCOME_NOTE[outcome] });
  const note = String(form.get("note") ?? "").trim();
  if (note) await supabase.rpc("log_lead_note", { p_lead: id, p_note: note });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Set or clear the call-back / interview from the lead page. */
export async function scheduleLead(_prev: { error?: string; ok?: string } | undefined, form: FormData) {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const id = String(form.get("id") ?? "");
  const kind = String(form.get("kind") ?? "");
  const patch: Record<string, unknown> = {};
  let note = "";

  if (kind === "callback" || kind === "interview") {
    const at = futureIso(String(form.get("at") ?? ""));
    if (!at) return { error: t("اختار معاد صحيح في المستقبل") };
    if (kind === "callback") {
      patch.callback_at = at;
      note = OUTCOME_NOTE.callback;
    } else {
      patch.interview_at = at;
      patch.interview_place = String(form.get("place") ?? "").trim().slice(0, 200) || null;
      patch.status = "interview";
      note = OUTCOME_NOTE.interview;
    }
  } else if (kind === "clear_callback") patch.callback_at = null;
  else if (kind === "clear_interview") {
    patch.interview_at = null;
    patch.interview_place = null;
  } else return { error: t("حصلت مشكلة، جرّب تاني") };

  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) return { error: t("مقدرتش أعدل الليد") };
  if (note) await supabase.rpc("log_lead_note", { p_lead: id, p_note: note });
  revalidatePath("/", "layout");
  return { ok: t("تم الحفظ") };
}

export async function logWhatsApp(leadId: string, title: string) {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  await supabase.rpc("log_lead_note", { p_lead: leadId, p_note: `💬 واتساب: ${title}`.slice(0, 200) });
  revalidatePath(`/agent/leads/${leadId}`);
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function deleteDocument(form: FormData) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const id = String(form.get("id") ?? "");
  const { data: doc } = await supabase.from("lead_documents").select("id, path").eq("id", id).maybeSingle();
  if (!doc) return;
  const { error } = await supabase.from("lead_documents").delete().eq("id", id);
  if (!error) await supabase.storage.from("lead-docs").remove([doc.path]);
  revalidatePath("/", "layout");
}

export async function clearSchedule(form: FormData) {
  await scheduleLead(undefined, form);
}

/** Called when the agent returns from the phone app; duration = time spent away. */
export async function logCall(leadId: string, startedAt: string, durationS: number) {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  const seconds = Math.max(0, Math.min(14_400, Math.round(durationS)));
  const started = Number.isNaN(Date.parse(startedAt)) ? new Date() : new Date(startedAt);
  const { error } = await supabase.from("call_logs").insert({ lead_id: leadId, agent_id: profile.id, started_at: started.toISOString(), duration_s: seconds });
  if (!error) {
    const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    await supabase.rpc("log_lead_note", { p_lead: leadId, p_note: `⏱️ مدة المكالمة ${mmss}` });
  }
}
