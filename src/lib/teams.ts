import "server-only";
import { cairoToday } from "@/lib/auth";
import type { BoardRow } from "@/lib/badges";
import { createClient } from "@/lib/supabase/server";

export type Period = "today" | "week" | "month";
export const PERIODS: [Period, string][] = [["today", "النهارده"], ["week", "الأسبوع ده"], ["month", "الشهر ده"]];

const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Cairo date range for a period; the week runs Saturday → today. */
export function periodRange(period: Period): [string, string] {
  const today = cairoToday();
  if (period === "today") return [today, today];
  if (period === "month") return [`${today.slice(0, 8)}01`, today];
  const sinceSaturday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7;
  return [addDays(today, -sinceSaturday), today];
}

export const asPeriod = (v: unknown): Period => (v === "week" || v === "month" ? v : "today");

export type TeamTotals = {
  id: string; name: string; leader: string | null; agents: number;
  leads: number; calls: number; interviews: number; hired: number; points: number;
  targetLeads: number; targetHired: number;
};

/** Every agent's numbers for the period plus each agent's targets, grouped by team. */
export async function loadTeamNumbers(from: string, to: string) {
  const supabase = await createClient();
  const [boardRes, teamsRes, targetsRes] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: from, p_to: to }),
    supabase.from("teams").select("id, name, leader:profiles!teams_leader_fk(full_name)").order("name"),
    supabase.from("daily_targets").select("agent_id, target_leads, target_hired").gte("date", from).lte("date", to),
  ]);
  const board = (boardRes.data ?? []) as BoardRow[];
  const targetByAgent = new Map<string, { leads: number; hired: number }>();
  for (const r of targetsRes.data ?? []) {
    const cur = targetByAgent.get(r.agent_id) ?? { leads: 0, hired: 0 };
    cur.leads += r.target_leads ?? 0;
    cur.hired += r.target_hired ?? 0;
    targetByAgent.set(r.agent_id, cur);
  }
  const teams: TeamTotals[] = (teamsRes.data ?? []).map((row) => {
    const members = board.filter((b) => b.team_id === row.id);
    const sum = (k: keyof Pick<BoardRow, "leads" | "calls" | "interviews" | "hired" | "points">) => members.reduce((s, m) => s + m[k], 0);
    return {
      id: row.id,
      name: row.name,
      leader: (row.leader as unknown as { full_name: string } | null)?.full_name ?? null,
      agents: members.length,
      leads: sum("leads"), calls: sum("calls"), interviews: sum("interviews"), hired: sum("hired"), points: sum("points"),
      targetLeads: members.reduce((s, m) => s + (targetByAgent.get(m.agent_id)?.leads ?? 0), 0),
      targetHired: members.reduce((s, m) => s + (targetByAgent.get(m.agent_id)?.hired ?? 0), 0),
    };
  });
  teams.sort((a, b) => b.hired - a.hired || b.points - a.points || a.name.localeCompare(b.name));
  return { teams, board, targetByAgent };
}
