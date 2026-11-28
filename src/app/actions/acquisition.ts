"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile, MANAGERS } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { requiredFieldsError } from "@/lib/status-rules";
import { createClient } from "@/lib/supabase/server";
import { cairoLocalToIso } from "@/lib/time";
import { VEHICLES } from "@/lib/types";

type State = { error?: string; ok?: string } | undefined;

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => {
  const v = str(form, key);
  return v === "" ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN;
};
const isVehicle = (v: string) => (VEHICLES as readonly string[]).includes(v);

// ───────── 1) Qualification (migration 0060) ─────────

/** Saves the lead's area, vehicle, licence and age in one call. */
export async function qualifyLead(_prev: State, form: FormData): Promise<State> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const id = str(form, "id");
  if (!UUID_RE.test(id)) return { error: t("حصلت مشكلة، جرّب تاني") };
  const governorate = num(form, "governorate_id");
  const region = num(form, "region_id");
  const age = num(form, "age");
  const vehicle = str(form, "vehicle");
  const license = str(form, "has_license");
  if (Number.isNaN(governorate) || Number.isNaN(region)) return { error: t("اختار المحافظة والمنطقة من القايمة") };
  if (Number.isNaN(age) || (age !== null && (age < 16 || age > 70))) return { error: t("السن لازم يكون بين 16 و70") };
  if (vehicle && !isVehicle(vehicle)) return { error: t("اختار المركبة من القايمة") };

  const supabase = await createClient();
  const { error } = await supabase.rpc("qualify_lead", {
    p_lead: id,
    p_governorate: governorate,
    p_region: governorate === null ? null : region,
    p_vehicle: vehicle || null,
    p_has_license: license === "yes" ? true : license === "no" ? false : null,
    p_age: age,
  });
  if (error) {
    if (error.code === "PGRST202") return { error: t("الجزء ده محتاج migration 0060 — اتأكد إنه اتطبق في Supabase") };
    if (error.message.includes("BAD_AGE")) return { error: t("السن لازم يكون بين 16 و70") };
    if (error.message.includes("BAD_REGION")) return { error: t("المنطقة دي مش في المحافظة اللي اخترتها") };
    if (error.message.includes("NOT_ALLOWED")) return { error: t("مش مسموحلك تعدّل الليد ده") };
    return { error: requiredFieldsError(t, error.message) ?? error.message };
  }
  revalidatePath("/", "layout");
  return { ok: t("تم الحفظ") };
}

/** What a company accepts: hiring areas, vehicles, licence, age range (managers). */
export async function saveCompanyRequirements(_prev: State, form: FormData): Promise<State> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!MANAGERS.includes(profile.role)) return { error: t("مش مسموح") };
  const id = str(form, "id");
  const minAge = num(form, "min_age");
  const maxAge = num(form, "max_age");
  if (Number.isNaN(minAge) || Number.isNaN(maxAge)) return { error: t("السن لازم يكون رقم") };
  if ((minAge !== null && (minAge < 16 || minAge > 70)) || (maxAge !== null && (maxAge < 16 || maxAge > 70))) return { error: t("السن لازم يكون بين 16 و70") };
  if (minAge !== null && maxAge !== null && minAge > maxAge) return { error: t("أقل سن أكبر من أكبر سن") };
  const vehicles = form.getAll("vehicles").map(String).filter(isVehicle);
  const governorates = form.getAll("governorate_id").map(Number).filter((n) => Number.isInteger(n) && n > 0);

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_company_requirements", {
    p_id: id,
    p_vehicles: vehicles,
    p_needs_license: form.get("needs_license") === "on",
    p_min_age: minAge,
    p_max_age: maxAge,
    p_governorates: governorates,
  });
  if (error) {
    if (error.code === "PGRST202") return { error: t("الجزء ده محتاج migration 0060 — اتأكد إنه اتطبق في Supabase") };
    return { error: error.message.includes("managers_only") ? t("مش مسموح") : error.message };
  }
  revalidatePath(`/admin/companies/${id}`);
  return { ok: t("تم الحفظ") };
}

// ───────── 2) Company requests (migration 0061) ─────────

/** Adds a request, or edits one when an id is sent. */
export async function saveCompanyRequest(_prev: State, form: FormData): Promise<State> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!MANAGERS.includes(profile.role)) return { error: t("مش مسموح") };
  const id = str(form, "id");
  const company = str(form, "company_id");
  const needed = num(form, "needed");
  const governorate = num(form, "governorate_id");
  const vehicle = str(form, "vehicle");
  const startsOn = str(form, "starts_on");
  const dueOn = str(form, "due_on");
  const priority = num(form, "priority") ?? 2;
  if (!UUID_RE.test(company)) return { error: t("اختار الشركة") };
  if (needed === null || Number.isNaN(needed) || needed < 1 || needed > 5000) return { error: t("اكتب العدد المطلوب (من 1 لـ 5000)") };
  if (Number.isNaN(governorate)) return { error: t("اختار المحافظة من القايمة") };
  if (vehicle && !isVehicle(vehicle)) return { error: t("اختار المركبة من القايمة") };
  if (startsOn && !DATE_RE.test(startsOn)) return { error: t("تاريخ البداية مش صحيح") };
  if (dueOn && !DATE_RE.test(dueOn)) return { error: t("آخر معاد مش صحيح") };
  if (startsOn && dueOn && dueOn < startsOn) return { error: t("آخر معاد لازم يكون بعد تاريخ البداية") };
  if (![1, 2, 3].includes(priority as number)) return { error: t("اختار الأولوية") };

  const row: Record<string, unknown> = {
    company_id: company,
    needed,
    governorate_id: governorate,
    vehicle: vehicle || null,
    due_on: dueOn || null,
    priority,
    notes: str(form, "notes").slice(0, 500) || null,
  };
  if (startsOn) row.starts_on = startsOn;

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("company_requests").update(row).eq("id", id)
    : await supabase.from("company_requests").insert(row);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return { error: t("الجزء ده محتاج migration 0061 — اتأكد إنه اتطبق في Supabase") };
    return { error: error.message };
  }
  revalidatePath("/admin/demand");
  return { ok: id ? t("تم الحفظ") : t("الطلب اتضاف") };
}

/** Closes (done / cancelled) or reopens a request. */
export async function setCompanyRequestStatus(_prev: State, form: FormData): Promise<State> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!MANAGERS.includes(profile.role)) return { error: t("مش مسموح") };
  const status = str(form, "status");
  if (!["open", "done", "cancelled"].includes(status)) return { error: t("اختيار غير صحيح") };
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_requests").update({ status }).eq("id", str(form, "id")).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: t("الطلب مش موجود أو مش مسموحلك تعدّله") };
  revalidatePath("/admin/demand");
  return { ok: t("تم الحفظ") };
}

// ───────── 4) Interviews (migration 0062) ─────────

const MARK_ERRORS: Record<string, string> = {
  not_found: "الليد مش موجود",
  closed: "الليد ده مقفول (اتعيّن أو اترفض)",
  bad_time: "اختار معاد صحيح في المستقبل",
  bad_result: "اختيار غير صحيح",
  not_allowed: "مش مسموحلك تعدّل الليد ده",
};

/** Attended / didn't come / moved to a new time. */
export async function markInterview(_prev: State, form: FormData): Promise<State> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "performance") return { error: t("مش مسموح") };
  const result = str(form, "result");
  const local = str(form, "at");
  const at = local ? cairoLocalToIso(local) : null;
  if (result === "rescheduled" && !at) return { error: t("اختار المعاد الجديد") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_interview", { p_lead: str(form, "id"), p_result: result, p_at: at });
  if (error) {
    if (error.code === "PGRST202") return { error: t("الجزء ده محتاج migration 0062 — اتأكد إنه اتطبق في Supabase") };
    return { error: requiredFieldsError(t, error.message) ?? error.message };
  }
  if (data !== "ok") return { error: t(MARK_ERRORS[String(data)] ?? "حصلت مشكلة، جرّب تاني") };
  revalidatePath("/", "layout");
  return { ok: result === "attended" ? t("تمام — الليد راح لمرحلة الأوراق") : result === "no_show" ? t("رجع للأجنت كمكالمة لتحديد معاد تاني") : t("المعاد اتغيّر") };
}
