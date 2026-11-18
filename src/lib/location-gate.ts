import "server-only";
import type { Session } from "@/lib/auth";

/** Returns the branch name the user must check in at, or null when they may use the system right now. */
export function pendingLocationCheck({ profile, locationOk, locationName }: Session): string | null {
  if (!profile.location_id || profile.allow_anywhere || (profile.role !== "agent" && profile.role !== "team_leader")) return null;
  return locationOk ? null : (locationName ?? "الفرع");
}
