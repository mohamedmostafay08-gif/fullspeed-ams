"use server";

import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LeadHit = { id: string; full_name: string; phone: string; status: string; company: string | null };

/** Quick search (Ctrl+K): a lead by phone or name. RLS keeps each person to the leads they may see. */
export async function searchLeads(raw: string): Promise<LeadHit[]> {
  const profile = await getProfile();
  if (!profile || profile.role === "performance") return [];
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const q = raw.replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d))).trim().slice(0, 60);
  let digits = q.replace(/[^\d]/g, "");
  const isPhone = digits.length >= 4 && digits.length >= q.replace(/\s|\+|-/g, "").length - 1;
  let filter: string;
  if (isPhone) {
    if (digits.startsWith("0020")) digits = "0" + digits.slice(4);
    else if (digits.startsWith("20") && digits.length >= 12) digits = "0" + digits.slice(2);
    filter = `phone.ilike.%${digits}%`;
  } else {
    const term = q.replace(/[%,()*\\.:]/g, "").trim();
    if (term.length < 2) return [];
    filter = `full_name.ilike.%${term}%`;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, full_name, phone, status, companies(name)")
    .or(filter)
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []).map((l) => ({
    id: l.id,
    full_name: l.full_name,
    phone: l.phone,
    status: l.status,
    company: (l.companies as unknown as { name: string } | null)?.name ?? null,
  }));
}
