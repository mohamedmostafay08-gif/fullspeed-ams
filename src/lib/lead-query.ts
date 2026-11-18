import "server-only";
import { cairoRange } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS } from "@/lib/types";

export type LeadFilters = { company?: string; agent?: string; status?: string; from?: string; to?: string; q?: string; page: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function readFilters(sp: Record<string, string | string[] | undefined>): LeadFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined) || undefined;
  return {
    company: UUID_RE.test(s("company") ?? "") ? s("company") : undefined,
    agent: s("agent") === "none" || UUID_RE.test(s("agent") ?? "") ? s("agent") : undefined,
    status: s("status") && s("status")! in LEAD_STATUS_LABELS ? s("status") : undefined,
    from: DATE_RE.test(s("from") ?? "") ? s("from") : undefined,
    to: DATE_RE.test(s("to") ?? "") ? s("to") : undefined,
    q: s("q")?.slice(0, 60),
    page: Math.max(1, Number(s("page")) || 1),
  };
}

export async function queryLeads(f: LeadFilters, opts: { limit: number; offset: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("leads")
    .select(
      "id, full_name, phone, status, source, created_at, form_data, notes, callback_at, interview_at, attempts, companies(name, logo_path), governorates(name_ar, name_en), regions(name_ar), agent:profiles!leads_agent_id_fkey(full_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (f.company) q = q.eq("company_id", f.company);
  if (f.agent === "none") q = q.is("agent_id", null);
  else if (f.agent) q = q.eq("agent_id", f.agent);
  if (f.status) q = q.eq("status", f.status);
  if (f.from || f.to) {
    const [start, end] = cairoRange(f.from ?? "2000-01-01", f.to ?? f.from ?? "2100-01-01");
    q = q.gte("created_at", start).lt("created_at", end);
  }
  if (f.q) {
    const term = f.q.replace(/[%,()*\\]/g, "");
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  return q;
}

export function filtersToQuery(f: LeadFilters, page?: number) {
  const p = new URLSearchParams();
  for (const k of ["company", "agent", "status", "from", "to", "q"] as const) if (f[k]) p.set(k, f[k]!);
  if (page && page > 1) p.set("page", String(page));
  return p.toString();
}

export type LeadsView = "table" | "board";
export const readView = (sp: Record<string, string | string[] | undefined>): LeadsView => (sp.view === "board" ? "board" : "table");
export const BOARD_LIMIT = 400;

type Row = {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  callback_at: string | null;
  interview_at: string | null;
  attempts: number;
  companies: unknown;
  agent: unknown;
};

export function toBoardLeads(rows: Row[]) {
  return rows.map((l) => ({
    id: l.id,
    full_name: l.full_name,
    phone: l.phone,
    status: l.status as import("@/lib/types").LeadStatus,
    company: l.companies as { name: string; logo_path: string | null },
    agent: (l.agent as { full_name: string } | null)?.full_name ?? null,
    callback_at: l.callback_at,
    interview_at: l.interview_at,
    attempts: l.attempts,
  }));
}
