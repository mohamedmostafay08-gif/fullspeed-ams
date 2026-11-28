import { PageHeader } from "@/components/app-shell";
import { ForecastCard, type Forecast } from "@/components/forecast";
import { BadgesCard, Leaderboard } from "@/components/leaderboard";
import { RangePicker, readRange } from "@/components/range-picker";
import { Scorecard } from "@/components/scorecard";
import { badgesFor, type AgentStats, type BoardRow } from "@/lib/badges";
import { cairoToday } from "@/lib/auth";
import { requireAgent } from "@/lib/view-as";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

/** «تقييمي»: the scorecard, plus today's leaderboard, badges and the month forecast that used to crowd the agent home. */
export default async function AgentScorecardPage({ searchParams }: PageProps<"/agent/scorecard">) {
  const t = await getT();
  const me = await requireAgent();
  const [from, to] = readRange(await searchParams);
  const today = cairoToday();
  const supabase = await createClient();
  const [boardRes, statsRes, forecastRes] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: today, p_to: today }),
    supabase.rpc("agent_stats", { p_agent: me.id }),
    supabase.rpc("month_forecast"),
  ]);
  const board = (boardRes.data ?? []) as BoardRow[];
  const myRank = board.findIndex((r) => r.agent_id === me.id) + 1 || null;
  const stats = (statsRes.data ?? { total_leads: 0, total_hired: 0, streak: 0, calls_today: 0, avg_first_touch_min: null, leads_7d: 0 }) as AgentStats;
  const badges = badgesFor(stats, myRank, board.find((r) => r.agent_id === me.id)?.points ?? 0);
  const forecast = forecastRes.data as Forecast | null;

  return (
    <>
      <PageHeader title={t("تقييمي")} subtitle={t("أرقامك مقارنة بمتوسط الفريق — عشان تعرف تتحسن في إيه")} />
      <div className="mb-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Leaderboard rows={board} me={me.id} />
        <BadgesCard badges={badges} />
        {forecast?.agents?.length ? <ForecastCard f={forecast} personal /> : null}
      </div>
      <RangePicker path="/agent/scorecard" from={from} to={to} />
      <Scorecard agentId={me.id} from={from} to={to} />
    </>
  );
}
