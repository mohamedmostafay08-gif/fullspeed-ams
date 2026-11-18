import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Company, Governorate, Region } from "@/lib/types";

export async function getGeo(): Promise<{ governorates: Governorate[]; regions: Region[] }> {
  const supabase = await createClient();
  const [g, r] = await Promise.all([
    supabase.from("governorates").select("id, name_ar, name_en").order("id"),
    supabase.from("regions").select("id, governorate_id, name_ar").order("name_ar").limit(5000),
  ]);
  return { governorates: g.data ?? [], regions: r.data ?? [] };
}

export async function getCompanies(activeOnly = false): Promise<Company[]> {
  const supabase = await createClient();
  let q = supabase.from("companies").select("id, name, slug, logo_path, description, form_schema, is_active").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as Company[];
}

export async function getAssignedCompanies(agentId: string): Promise<Company[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_companies")
    .select("companies(id, name, slug, logo_path, description, form_schema, is_active)")
    .eq("agent_id", agentId);
  return ((data ?? []).map((r) => r.companies).filter(Boolean) as unknown as Company[])
    .filter((c) => c.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  return count ?? 0;
}
