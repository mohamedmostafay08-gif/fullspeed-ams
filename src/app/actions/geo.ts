"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CheckInResult = { ok: boolean; reason?: "far" | "accuracy" | "error"; distance?: number; location?: string; radius?: number; accuracy?: number };

export async function checkIn(lat: number, lng: number, accuracy: number): Promise<CheckInResult> {
  if (![lat, lng, accuracy].every(Number.isFinite)) return { ok: false, reason: "error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("geo_check_in", { p_lat: lat, p_lng: lng, p_accuracy: accuracy });
  if (error) return { ok: false, reason: "error" };
  if ((data as CheckInResult).ok) revalidatePath("/", "layout");
  return data as CheckInResult;
}
