import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, team_id, is_active")
    .eq("id", userId)
    .single();
  return profile?.is_active ? profile : null;
});

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
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
