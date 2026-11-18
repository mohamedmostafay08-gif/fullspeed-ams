"use server";

import type { ActionState } from "@/app/admin/actions";
import { getProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function changePassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const t = await getT();
  const profile = await getProfile();
  if (!profile) return { error: t("سجّل دخول الأول") };
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: t("كلمة السر لازم 8 حروف على الأقل") };
  if (password !== String(form.get("confirm") ?? "")) return { error: t("كلمتين السر مش زي بعض") };
  const { error } = await (await createClient()).auth.updateUser({ password });
  return error ? { error: t("مقدرتش أغيّر كلمة السر") } : { ok: t("تم تغيير كلمة السر") };
}
