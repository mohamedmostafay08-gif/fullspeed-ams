"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { recordFailedLogin, recordLogin } from "@/lib/login-log";
import { VIEW_AS_COOKIE } from "@/lib/view-as-cookie";

export type SignInState = { error?: string; email?: string } | undefined;

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const t = await getT();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: t("اكتب الإيميل وكلمة السر"), email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordFailedLogin(email);
    return { error: t("الإيميل أو كلمة السر غلط"), email };
  }

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: t("الحساب ده مش مفعّل — كلم الأدمن"), email };
  }
  await recordLogin(data.user.id, "password");
  redirect(profile.role === "agent" ? "/agent" : "/admin");
}

export async function signOut(form?: FormData) {
  const supabase = await createClient();
  // Forget this device's push subscription (the browser already unsubscribed it).
  const endpoint = String(form?.get("endpoint") ?? "");
  if (endpoint) await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  await supabase.auth.signOut();
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/login");
}
