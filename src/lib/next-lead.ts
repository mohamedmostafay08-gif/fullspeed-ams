import type { createClient } from "@/lib/supabase/server";

/** How "who do I call next" is decided, shared by the agent home card and calling mode (/agent/next):
 *  call-backs whose time came, then new leads, then no-answers last tried over 2 hours ago (under 5 tries). */
export const RETRY_AFTER_MS = 2 * 3_600_000;
export const MAX_ATTEMPTS = 5;
export type Queue = "callback" | "new" | "retry";

type Client = Awaited<ReturnType<typeof createClient>>;

export function queueClock() {
  const ms = Date.now();
  return { now: new Date(ms).toISOString(), retryBefore: new Date(ms - RETRY_AFTER_MS).toISOString() };
}

/** One query per queue, limit 1 each; returns the first non-empty one. Runs under the caller's RLS. */
export async function pickNextLead<Row>(supabase: Client, agentId: string, select: string, skip: string[] = []) {
  const { now, retryBefore } = queueClock();
  const base = () => {
    let q = supabase.from("leads").select(select).eq("agent_id", agentId);
    if (skip.length) q = q.not("id", "in", `(${skip.join(",")})`);
    return q;
  };
  const [due, fresh, retry] = await Promise.all([
    base().lte("callback_at", now).not("status", "in", "(hired,rejected)").order("callback_at").limit(1),
    base().eq("status", "new").is("callback_at", null).order("created_at").limit(1),
    base()
      .eq("status", "no_answer")
      .is("callback_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .or(`last_contact_at.is.null,last_contact_at.lt.${retryBefore}`)
      .order("last_contact_at", { nullsFirst: true })
      .limit(1),
  ]);
  const picks: [Queue, { data: unknown[] | null }][] = [["callback", due], ["new", fresh], ["retry", retry]];
  const found = picks.find(([, r]) => r.data?.length);
  return { lead: (found?.[1].data?.[0] ?? null) as Row | null, queue: found?.[0] ?? null };
}
