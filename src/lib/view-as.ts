import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";
import { VIEW_AS_COOKIE, parseViewAs } from "@/lib/view-as-cookie";

export { VIEW_AS_COOKIE };

/** Who may open «شوف كأجنت». Their own RLS already lets them read every agent's rows. */
export const VIEW_AS_ROLES: Role[] = ["admin"];

export type ViewAs = { viewer: Profile; agent: Profile };

/**
 * The agent the signed-in admin is looking through, or null. The cookie only names the agent;
 * the viewer's real role is checked on every request, so a stale cookie on someone else's
 * session does nothing.
 */
export const getViewAs = cache(async (): Promise<ViewAs | null> => {
  const parsed = parseViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value);
  if (!parsed) return null;
  const me = await getProfile();
  if (!me || me.id !== parsed.viewer || !VIEW_AS_ROLES.includes(me.role)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, team_id, is_active, location_id, allow_anywhere")
    .eq("id", parsed.agent)
    .eq("role", "agent")
    .maybeSingle();
  return data ? { viewer: me, agent: data as Profile } : null;
});

/** For the agent pages: the agent being viewed when an admin is looking, else the signed-in agent. */
export async function requireAgent(): Promise<Profile> {
  const view = await getViewAs();
  return view ? view.agent : requireRole("agent");
}
