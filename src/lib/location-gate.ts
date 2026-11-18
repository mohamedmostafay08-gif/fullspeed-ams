import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Returns the branch name the user must check in at, or null when they may use the system right now. */
export async function pendingLocationCheck(profile: Profile): Promise<string | null> {
  if (!profile.location_id || profile.allow_anywhere || (profile.role !== "agent" && profile.role !== "team_leader")) return null;
  const supabase = await createClient();
  const [{ data: ok }, { data: loc }] = await Promise.all([
    supabase.rpc("location_ok"),
    supabase.from("work_locations").select("name").eq("id", profile.location_id).maybeSingle(),
  ]);
  return ok ? null : (loc?.name ?? "الفرع");
}
