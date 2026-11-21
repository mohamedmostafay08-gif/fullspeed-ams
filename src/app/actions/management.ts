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
  await requireRole("manager");
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
  await requireRole("manager");
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
