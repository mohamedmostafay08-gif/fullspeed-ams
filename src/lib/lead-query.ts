import "server-only";
import { cairoRange, cairoToday } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LEAD_SOURCES, LEAD_STATUS_LABELS, REJECT_REASONS } from "@/lib/types";

export const ATTEMPTS = { "0": "محدش كلمه", "1-2": "1 أو 2 محاولة", "3+": "3 محاولات أو أكتر" } as const;
export const FLAGS = {
  never: "لسه محدش كلمه",
  callback_due: "مكالمة متأجلة جه معادها",
  interview_today: "عنده مقابلة النهارده",
  interview_upcoming: "عنده مقابلة جاية",
  stale: "مفيش تواصل من 3 أيام",
  no_next: "مفتوح ومالوش خطوة جاية",
  stuck: "فات المدة في حالته",
} as const;
export const DATE_FIELDS = { created: "تاريخ التسجيل", hired: "تاريخ التعيين", contact: "آخر تواصل" } as const;
export const SORTS = { new: "الأحدث", old: "الأقدم", attempts: "أكتر محاولات", contact: "آخر تواصل" } as const;

export type LeadFilters = {
  company?: string; agent?: string; status?: string; from?: string; to?: string; q?: string; page: number;
  team?: string; gov?: string; source?: string; reason?: string;
  attempts?: keyof typeof ATTEMPTS; flag?: keyof typeof FLAGS; datefield?: keyof typeof DATE_FIELDS;
  fkey?: string; fval?: string; sort?: keyof typeof SORTS; campaign?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const KEY_RE = /^[a-z0-9_]{1,40}$/i;
const NO_MATCH = "00000000-0000-0000-0000-000000000000";
const pick = <T extends Record<string, unknown>>(v: string | undefined, map: T) => (v && Object.hasOwn(map, v) ? (v as keyof T & string) : undefined);

/** The filters that go beyond the basic row; the advanced panel opens when any is set. */
export const ADVANCED_KEYS = ["team", "gov", "source", "reason", "attempts", "flag", "datefield", "fkey", "sort", "campaign"] as const;

export function readFilters(sp: Record<string, string | string[] | undefined>): LeadFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined) || undefined;
  const fkey = KEY_RE.test(s("fkey") ?? "") ? s("fkey") : undefined;
  return {
    company: UUID_RE.test(s("company") ?? "") ? s("company") : undefined,
    agent: s("agent") === "none" || UUID_RE.test(s("agent") ?? "") ? s("agent") : undefined,
    status: pick(s("status"), LEAD_STATUS_LABELS),
    from: DATE_RE.test(s("from") ?? "") ? s("from") : undefined,
    to: DATE_RE.test(s("to") ?? "") ? s("to") : undefined,
    q: s("q")?.slice(0, 60),
    page: Math.max(1, Number(s("page")) || 1),
    team: UUID_RE.test(s("team") ?? "") ? s("team") : undefined,
    gov: /^\d{1,4}$/.test(s("gov") ?? "") ? s("gov") : undefined,
    source: pick(s("source"), LEAD_SOURCES),
    reason: pick(s("reason"), REJECT_REASONS),
    attempts: pick(s("attempts"), ATTEMPTS),
    flag: pick(s("flag"), FLAGS),
    datefield: pick(s("datefield"), DATE_FIELDS),
    fkey,
    fval: fkey ? s("fval")?.slice(0, 80) : undefined,
    sort: pick(s("sort"), SORTS),
    campaign: s("campaign")?.slice(0, 200),
  };
}

export const hasAdvanced = (f: LeadFilters) => ADVANCED_KEYS.some((k) => f[k]);

export async function queryLeads(f: LeadFilters, opts: { limit: number; offset: number }) {
  const supabase = await createClient();
  let teamIds: string[] | null = null;
  if (f.team) {
    const { data } = await supabase.from("profiles").select("id").eq("team_id", f.team);
    teamIds = (data ?? []).map((r) => r.id);
  }
  const dateCol = f.datefield === "hired" ? "hired_at" : f.datefield === "contact" ? "last_contact_at" : "created_at";
  const sortCol = f.sort === "attempts" ? "attempts" : f.sort === "contact" ? "last_contact_at" : "created_at";
  let q = supabase
    .from("leads")
    .select(
      "id, full_name, phone, status, source, created_at, form_data, notes, callback_at, interview_at, attempts, companies(name, logo_path), governorates(name_ar, name_en), regions(name_ar), agent:profiles!leads_agent_id_fkey(full_name)",
      { count: "exact" },
    )
    .order(sortCol, { ascending: f.sort === "old", nullsFirst: false })
    // Leads imported together share a timestamp; the id keeps paging stable.
    .order("id", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (f.company) q = q.eq("company_id", f.company);
  if (f.agent === "none") q = q.is("agent_id", null);
  else if (f.agent) q = q.eq("agent_id", f.agent);
  if (teamIds) q = q.in("agent_id", teamIds.length ? teamIds : [NO_MATCH]);
  if (f.status) q = q.eq("status", f.status);
  if (f.gov) q = q.eq("governorate_id", Number(f.gov));
  if (f.source) q = q.eq("source", f.source);
  if (f.reason) q = q.eq("reject_reason", f.reason);
  if (f.attempts === "0") q = q.eq("attempts", 0);
  if (f.attempts === "1-2") q = q.gte("attempts", 1).lte("attempts", 2);
  if (f.attempts === "3+") q = q.gte("attempts", 3);
  const now = new Date().toISOString();
  if (f.flag === "never") q = q.eq("attempts", 0).in("status", ["new"]);
  if (f.flag === "callback_due") q = q.not("callback_at", "is", null).lte("callback_at", now);
  if (f.flag === "interview_upcoming") q = q.gte("interview_at", now);
  if (f.flag === "interview_today") {
    const [s, e] = cairoRange(cairoToday(), cairoToday());
    q = q.gte("interview_at", s).lt("interview_at", e);
  }
  if (f.flag === "stale") {
    q = q.in("status", ["contacted", "interview", "documents"]).lt("last_contact_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
  }
  if (f.flag === "no_next") q = q.in("status", ["no_answer", "contacted", "interview", "documents"]).lt("next_step_at", now);
  if (f.flag === "stuck") q = q.lt("status_due_at", now).not("status", "in", "(hired,rejected)");
  if (f.campaign) q = q.eq("campaign_name", f.campaign);
  if (f.from || f.to) {
    const [start, end] = cairoRange(f.from ?? "2000-01-01", f.to ?? f.from ?? "2100-01-01");
    q = q.gte(dateCol, start).lt(dateCol, end);
  }
  if (f.company && f.fkey && f.fval) q = q.eq(`form_data->>${f.fkey}`, f.fval);
  if (f.q) {
    const term = f.q.replace(/[%,()*\\]/g, "");
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  return q;
}

export function filtersToQuery(f: LeadFilters, page?: number) {
  const p = new URLSearchParams();
  for (const k of ["company", "agent", "status", "from", "to", "q", ...ADVANCED_KEYS, "fval"] as const) if (f[k]) p.set(k, String(f[k]));
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
