"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isValidEgyptMobile, normalizePhone, readCustomFields } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import type { FormField, LeadStatus } from "@/lib/types";

export type LeadFormState = { error?: string; duplicateOf?: string } | undefined;

const STATUSES: LeadStatus[] = ["new", "no_answer", "contacted", "interview", "documents", "hired", "rejected"];

export async function createLead(_prev: LeadFormState, form: FormData): Promise<LeadFormState> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();

  const companyId = String(form.get("company_id") ?? "");
  const { data: company } = await supabase.from("companies").select("id, form_schema, is_active").eq("id", companyId).single();
  if (!company?.is_active) return { error: "اختار شركة" };

  const fullName = String(form.get("full_name") ?? "").trim();
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (fullName.length < 3) return { error: "اكتب اسم المتقدم كامل" };
  if (!isValidEgyptMobile(phone)) return { error: "رقم الموبايل غير صحيح (لازم 11 رقم ويبدأ بـ 01)" };

  const { data: custom, errors } = readCustomFields(company.form_schema as FormField[], form);
  if (errors.length) return { error: errors.join(" · ") };

  if (form.get("allow_duplicate") !== "1") {
    const { data: taken } = await supabase.rpc("lead_phone_taken", { p_company: companyId, p_phone: phone });
    if (taken) return { error: "الرقم ده متسجل قبل كده على نفس الشركة", duplicateOf: "1" };
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
  if (error) return { error: "مقدرتش أحفظ الليد — اتأكد إنك متعين على الشركة دي" };

  revalidatePath("/", "layout");
  redirect(staff ? `/admin/leads/${lead.id}` : `/agent/leads/${lead.id}`);
}

export async function updateLead(form: FormData) {
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
    if (error) throw new Error("مقدرتش أعدل الليد");
  }
  revalidatePath("/", "layout");
}
