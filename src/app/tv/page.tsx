import { LiveRefresh } from "@/components/live";
import { TvBoard, type TvData } from "@/components/tv-board";
import { cairoRange, cairoToday, getProfile } from "@/lib/auth";
import type { BoardRow } from "@/lib/badges";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Full Speed — TV" };

export default async function TvPage() {
  const supabase = await createClient();
  const isPerf = (await getProfile())?.role === "performance";
  const db = isPerf ? createAdminClient() : supabase;
  const today = cairoToday();
  const [start, end] = cairoRange(today, today);
  const [boardRes, leadsRes, hiresRes, teamsRes] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: today, p_to: today }),
    db.from("leads").select("company_id, companies(name, logo_path)").gte("created_at", start).lt("created_at", end).limit(10000),
    db
      .from("leads")
      .select("id, full_name, hired_at, companies(name, logo_path), agent:profiles!leads_agent_id_fkey(full_name)")
      .gte("hired_at", start)
      .lt("hired_at", end)
      .order("hired_at", { ascending: false })
      .limit(30),
    supabase.from("teams").select("id, name"),
  ]);

  const board = (boardRes.data ?? []) as BoardRow[];
  const byCompany = new Map<string, { name: string; logo: string | null; leads: number; hired: number }>();
  for (const l of leadsRes.data ?? []) {
    const c = l.companies as unknown as { name: string; logo_path: string | null };
    const row = byCompany.get(l.company_id) ?? { name: c.name, logo: c.logo_path, leads: 0, hired: 0 };
    row.leads++;
    byCompany.set(l.company_id, row);
  }
  const hires = (hiresRes.data ?? []).map((h) => {
    const c = h.companies as unknown as { name: string; logo_path: string | null };
    return { id: h.id, lead: isPerf ? "🎉" : h.full_name, at: h.hired_at!, company: c.name, logo: c.logo_path, agent: (h.agent as unknown as { full_name: string } | null)?.full_name ?? "—" };
  });
  for (const h of hires) {
    const row = [...byCompany.values()].find((r) => r.name === h.company);
    if (row) row.hired++;
    else byCompany.set(h.company, { name: h.company, logo: h.logo, leads: 0, hired: 1 });
  }

  const data: TvData = {
    day: today,
    board,
    companies: [...byCompany.values()].sort((a, b) => b.hired - a.hired || b.leads - a.leads).slice(0, 12),
    hires,
    // Teams ranked by today's hires, then points.
    teams: (teamsRes.data ?? [])
      .map((tm) => {
        const members = board.filter((b) => b.team_id === tm.id);
        return {
          name: tm.name,
          agents: members.length,
          leads: members.reduce((s, m) => s + m.leads, 0),
          hired: members.reduce((s, m) => s + m.hired, 0),
          points: members.reduce((s, m) => s + m.points, 0),
        };
      })
      .sort((a, b) => b.hired - a.hired || b.points - a.points),
    totals: {
      leads: board.reduce((s, r) => s + r.leads, 0),
      calls: board.reduce((s, r) => s + r.calls, 0),
      interviews: board.reduce((s, r) => s + r.interviews, 0),
      hired: hires.length,
    },
  };
  return (
    <>
      <LiveRefresh channel="tv" />
      <TvBoard data={data} />
    </>
  );
}
