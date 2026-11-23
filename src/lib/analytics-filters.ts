import { LEAD_SOURCES } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Filters that narrow every number on the analytics and report pages. */
export type AnalyticsFilters = { team?: string; company?: string; agent?: string; source?: string; gov?: string };
export const AF_KEYS = ["team", "company", "agent", "source", "gov"] as const;

export function readAnalyticsFilters(sp: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined) || undefined;
  return {
    team: UUID_RE.test(s("team") ?? "") ? s("team") : undefined,
    company: UUID_RE.test(s("company") ?? "") ? s("company") : undefined,
    agent: UUID_RE.test(s("agent") ?? "") ? s("agent") : undefined,
    source: s("source") && s("source")! in LEAD_SOURCES ? s("source") : undefined,
    gov: /^\d{1,4}$/.test(s("gov") ?? "") ? s("gov") : undefined,
  };
}

export const anyFilter = (f: AnalyticsFilters) => AF_KEYS.some((k) => f[k]);

export function afQuery(f: AnalyticsFilters) {
  const p = new URLSearchParams();
  for (const k of AF_KEYS) if (f[k]) p.set(k, f[k]!);
  return p.toString();
}

/** RPC arguments for analytics_filtered / analytics_weekly. */
export const afArgs = (f: AnalyticsFilters) => ({
  p_team: f.team ?? null,
  p_company: f.company ?? null,
  p_agent: f.agent ?? null,
  p_source: f.source ?? null,
  p_governorate: f.gov ? Number(f.gov) : null,
});
