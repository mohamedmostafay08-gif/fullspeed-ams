import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

export const STAFF: Role[] = ["admin", "manager", "team_leader"];
export const MANAGERS: Role[] = ["admin", "manager"];
/** Everyone who may open the numbers pages: staff plus the read-only performance role. */
export const VIEWERS: Role[] = [...STAFF, "performance"];

export type Session = { profile: Profile; unread: number; locationOk: boolean; locationName: string | null };

/** Profile + unread count + location state in a single database round trip (cached per request). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_session");
  const s = data as { profile: Profile; unread: number; location_ok: boolean; location_name: string | null } | null;
  if (!s?.profile?.is_active) return null;
  return { profile: s.profile, unread: s.unread, locationOk: s.location_ok, locationName: s.location_name };
});

export const getProfile = cache(async (): Promise<Profile | null> => (await getSession())?.profile ?? null);

// A signed-in user without an active profile must not bounce between "/" and "/login".
export const NO_PROFILE_URL = "/login?e=inactive";

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect(NO_PROFILE_URL);
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

export function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

function cairoOffset(date: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  return name?.replace("GMT", "") || "+02:00";
}

/** [start, end) ISO timestamps covering whole Cairo days from..to (Egypt observes DST). */
export function cairoRange(from: string, to: string): [string, string] {
  const next = new Date(new Date(`${to}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return [`${from}T00:00:00${cairoOffset(from)}`, `${next}T00:00:00${cairoOffset(next)}`];
}
