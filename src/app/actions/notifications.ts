"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function markAllRead() {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ is_read: true }).eq("user_id", profile.id).eq("is_read", false);
  revalidatePath("/", "layout");
}

export async function setTaskStatus(form: FormData) {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  const status = String(form.get("status"));
  const allowed = profile.role === "agent" ? ["pending", "in_progress", "done"] : ["pending", "in_progress", "done", "cancelled"];
  if (!allowed.includes(status)) return;
  await supabase.from("tasks").update({ status }).eq("id", String(form.get("id")));
  revalidatePath("/", "layout");
}
