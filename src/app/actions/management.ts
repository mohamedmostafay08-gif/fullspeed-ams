"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { MANAGERS, STAFF, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// ───────── Approval requests (manager → admin) ─────────
export async function requestAccountChange(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("manager", "team_leader");
  const kind = str(form, "kind");
  const reason = str(form, "reason");
  if (kind !== "deactivate" && kind !== "activate") return { error: t("طلب غير معروف") };
  if (reason.length < 3) return { error: t("اكتب سبب الطلب") };
  const supabase = await createClient();
  const { error } = await supabase.from("admin_requests").insert({ kind, target_id: str(form, "target_id"), reason });
  if (error) return { error: error.code === "23505" ? t("فيه طلب مستني للموظف ده بالفعل") : t("مقدرتش أبعت الطلب") };
  revalidatePath("/admin", "layout");
  return { ok: t("الطلب اتبعت للأدمن") };
}

export async function decideRequest(form: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  await supabase.rpc("decide_admin_request", {
    p_id: str(form, "id"),
    p_approve: str(form, "decision") === "approve",
    p_note: str(form, "note") || null,
  });
  revalidatePath("/admin", "layout");
}

export async function cancelRequest(form: FormData) {
  await requireRole("manager", "team_leader");
  const supabase = await createClient();
  await supabase.rpc("cancel_admin_request", { p_id: str(form, "id") });
  revalidatePath("/admin", "layout");
}

// ───────── Attendance settings ─────────
export async function saveWorkSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const shift = str(form, "shift_start");
  const grace = Number(str(form, "grace_minutes"));
  const offDays = form.getAll("off_days").map(Number).filter((d) => d >= 1 && d <= 7);
  if (!/^\d{2}:\d{2}$/.test(shift)) return { error: t("اكتب معاد بداية الشيفت") };
  if (!Number.isInteger(grace) || grace < 0 || grace > 180) return { error: t("السماح لازم يكون من 0 لـ 180 دقيقة") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("work_settings")
    .update({ shift_start: shift, grace_minutes: grace, off_days: offDays, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: t("مقدرتش أحفظ") };
  revalidatePath("/admin/attendance");
  return { ok: t("تم الحفظ") };
}

// ───────── Sign-in log ─────────
export async function forceSignOutUser(form: FormData) {
  await requireRole("admin");
  const supabase = await createClient();
  await supabase.rpc("force_sign_out", { p_user: str(form, "user_id") });
  revalidatePath("/admin/logins");
}

// ───────── Memos ─────────
export async function postMemo(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const title = str(form, "title");
  const body = str(form, "body");
  if (title.length < 2 || body.length < 2) return { error: t("اكتب العنوان والرسالة") };
  // A team leader always posts to their own team; managers choose everyone or one team.
  const teamId = me.role === "team_leader" ? me.team_id : str(form, "team_id") || null;
  if (me.role === "team_leader" && !teamId) return { error: t("إنت مش متعين على تيم") };
  const supabase = await createClient();
  const { error } = await supabase.from("broadcasts").insert({ title, body, team_id: teamId });
  if (error) return { error: t("مقدرتش أبعت التعميم") };
  revalidatePath("/admin/memos");
  return { ok: t("التعميم اتبعت ووصل إشعار للكل") };
}

export async function deleteMemo(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.from("broadcasts").delete().eq("id", str(form, "id"));
  revalidatePath("/admin/memos");
}

// ───────── Leave requests ─────────
const LEAVE_ERRORS: Record<string, string> = {
  bad_dates: "تاريخ النهاية قبل البداية",
  too_long: "أقصى إجازة في الطلب الواحد 60 يوم",
  past_date: "مينفعش تطلب إجازة في يوم فات (المرضي بس لحد أسبوع فات)",
  overlap: "عندك طلب إجازة في نفس الأيام دي",
  no_workdays: "الأيام دي كلها إجازة أسبوعية أصلاً",
  not_allowed: "مش من صلاحيتك",
  not_pending: "الطلب ده اتقفل خلاص",
  cannot_cancel: "مينفعش تلغي الطلب ده",
};
const leaveError = (msg: string) => LEAVE_ERRORS[Object.keys(LEAVE_ERRORS).find((k) => msg.includes(k)) ?? ""] ?? "حصلت مشكلة، جرّب تاني";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function requestLeave(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("agent", "team_leader", "manager");
  const kind = str(form, "kind");
  const from = str(form, "start_date");
  const to = str(form, "end_date") || from;
  if (!["annual", "casual", "sick", "unpaid"].includes(kind)) return { error: t("اختار نوع الإجازة") };
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { error: t("اختار التاريخ") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_leave", { p_kind: kind, p_from: from, p_to: to, p_reason: str(form, "reason") });
  if (error) return { error: t(leaveError(error.message)) };
  revalidatePath("/", "layout");
  return { ok: t("الطلب اتبعت — هيوصلك إشعار بالرد") };
}

export async function decideLeave(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.rpc("decide_leave", { p_id: str(form, "id"), p_approve: str(form, "decision") === "approve", p_note: str(form, "note") });
  revalidatePath("/admin", "layout");
}

export async function cancelLeave(form: FormData) {
  await requireRole("agent", "team_leader", "manager");
  const supabase = await createClient();
  await supabase.rpc("cancel_leave", { p_id: str(form, "id") });
  revalidatePath("/", "layout");
}

// ───────── Hourly permits ─────────
const TIME_RE = /^\d{2}:\d{2}$/;
const PERMIT_ERRORS: Record<string, string> = {
  bad_time: "معاد الوصول لازم يكون بعد بداية الشيفت",
  too_long: "إذن التأخير أقصاه 4 ساعات بعد بداية الشيفت",
  past_date: "اختار يوم من النهارده لحد 30 يوم قدام",
  no_workdays: "اليوم ده إجازة أصلاً",
  overlap: "عندك إذن من نفس النوع أو إجازة في اليوم ده",
};

export async function requestPermit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole("agent", "team_leader", "manager");
  const kind = str(form, "kind");
  const day = str(form, "day");
  const time = str(form, "at_time");
  if (kind !== "late_arrival" && kind !== "early_leave") return { error: t("اختار نوع الإذن") };
  if (!DATE_RE.test(day) || !TIME_RE.test(time)) return { error: t("اختار اليوم والساعة") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_permit", { p_kind: kind, p_day: day, p_time: time, p_reason: str(form, "reason") });
  if (error) {
    const key = Object.keys(PERMIT_ERRORS).find((k) => error.message.includes(k));
    return { error: t(key ? PERMIT_ERRORS[key] : leaveError(error.message)) };
  }
  revalidatePath("/", "layout");
  return { ok: t("الطلب اتبعت — هيوصلك إشعار بالرد") };
}

export async function decidePermit(form: FormData) {
  await requireRole(...STAFF);
  const supabase = await createClient();
  await supabase.rpc("decide_permit", { p_id: str(form, "id"), p_approve: str(form, "decision") === "approve", p_note: str(form, "note") });
  revalidatePath("/admin", "layout");
}

export async function cancelPermit(form: FormData) {
  await requireRole("agent", "team_leader", "manager");
  const supabase = await createClient();
  await supabase.rpc("cancel_permit", { p_id: str(form, "id") });
  revalidatePath("/", "layout");
}

// ───────── Official holidays (admin & managers) ─────────
export async function addHoliday(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  await requireRole(...MANAGERS);
  const from = str(form, "day");
  const to = str(form, "to") || from;
  const name = str(form, "name").slice(0, 80);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return { error: t("اختار التاريخ") };
  if (!name) return { error: t("اكتب اسم الإجازة") };
  const days: { day: string; name: string }[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`) && days.length < 15; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push({ day: d.toISOString().slice(0, 10), name });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").upsert(days);
  if (error) return { error: t("مقدرتش أحفظ") };
  revalidatePath("/", "layout");
  return { ok: t("اتضافت {0} يوم", days.length) };
}

export async function deleteHoliday(form: FormData) {
  await requireRole(...MANAGERS);
  const supabase = await createClient();
  await supabase.from("public_holidays").delete().eq("day", str(form, "day"));
  revalidatePath("/", "layout");
}
