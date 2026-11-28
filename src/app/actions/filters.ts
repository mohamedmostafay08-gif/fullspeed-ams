"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/admin/actions";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Saves the current filter under a name the person picks. */
export async function saveFilter(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await getProfile())) return { error: "سجّل دخول الأول" };
  const page = str(form, "page");
  const name = str(form, "name").slice(0, 60);
  const query = str(form, "query").slice(0, 2000);
  if (!name) return { error: "اكتب اسم للفلتر" };
  if (!query || (page !== "leads" && page !== "analytics")) return { error: "مفيش فلتر أحفظه" };
  const supabase = await createClient();
  const { error } = await supabase.from("saved_filters").insert({ page, name, query });
  if (error) return { error: `مقدرتش أحفظ الفلتر: ${error.message}` };
  revalidatePath(str(form, "path") || "/");
  return { ok: "اتحفظ ✓" };
}

export async function deleteFilter(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await getProfile())) return { error: "سجّل دخول الأول" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("saved_filters").delete().eq("id", str(form, "id")).select("id");
  if (error) return { error: `مقدرتش أمسح الفلتر: ${error.message}` };
  if (!data?.length) return { error: "الفلتر مش موجود" };
  revalidatePath(str(form, "path") || "/");
  return { ok: "اتمسح ✓" };
}
