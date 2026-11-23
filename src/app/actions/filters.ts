"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Saves the current filter under a name the person picks. */
export async function saveFilter(form: FormData) {
  if (!(await getProfile())) return;
  const page = str(form, "page");
  const name = str(form, "name").slice(0, 60);
  const query = str(form, "query").slice(0, 2000);
  if (!name || !query || (page !== "leads" && page !== "analytics")) return;
  const supabase = await createClient();
  await supabase.from("saved_filters").insert({ page, name, query });
  revalidatePath(str(form, "path") || "/");
}

export async function deleteFilter(form: FormData) {
  if (!(await getProfile())) return;
  const supabase = await createClient();
  await supabase.from("saved_filters").delete().eq("id", str(form, "id"));
  revalidatePath(str(form, "path") || "/");
}
