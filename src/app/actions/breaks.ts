"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type BreakActionState = { error?: string; ok?: string } | undefined;

const MESSAGES: Record<string, string> = {
  BREAK_LIMIT: "خلّصت البريكين بتوع النهارده",
  BREAK_OPEN: "عندك طلب بريك مفتوح بالفعل",
  BREAK_NOT_ALLOWED: "البريك للأجنتس بس",
  NOT_PENDING: "الطلب ده اتعامل معاه خلاص",
  FORBIDDEN: "مش مسموحلك",
  NOT_FOUND: "الطلب مش موجود",
};

function explain(message: string | undefined) {
  const code = Object.keys(MESSAGES).find((k) => message?.includes(k));
  return code ? MESSAGES[code] : "حصلت مشكلة، جرّب تاني";
}

export async function requestBreak(): Promise<BreakActionState> {
  if (!(await getProfile())) return { error: "سجّل دخول الأول" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_break");
  if (error) return { error: explain(error.message) };
  revalidatePath("/", "layout");
  return { ok: "اتبعت الطلب — هيوصلك إشعار أول ما يتوافق عليه" };
}

export async function endBreak(id: string): Promise<BreakActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_break", { p_id: id });
  if (error) return { error: explain(error.message) };
  revalidatePath("/", "layout");
  return { ok: "تمام" };
}

export async function decideBreak(id: string, approve: boolean): Promise<BreakActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_break", { p_id: id, p_approve: approve });
  if (error) return { error: explain(error.message) };
  revalidatePath("/", "layout");
  return { ok: approve ? "اتوافق" : "اترفض" };
}
