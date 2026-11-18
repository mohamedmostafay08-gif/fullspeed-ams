"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export type SignInState = { error?: string; email?: string } | undefined;

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const t = await getT();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: t("اكتب الإيميل وكلمة السر"), email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: t("الإيميل أو كلمة السر غلط"), email };

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: t("الحساب ده مش مفعّل — كلم الأدمن"), email };
  }
  redirect(profile.role === "agent" ? "/agent" : "/admin");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
