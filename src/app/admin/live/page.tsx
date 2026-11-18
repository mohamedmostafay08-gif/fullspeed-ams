import Link from "next/link";
import { Tv } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live";
import { LiveBoard, type LiveAgent } from "@/components/live-board";
import { Empty } from "@/components/ui";
import { cairoRange, cairoToday, requireRole, STAFF } from "@/lib/auth";
import type { BoardRow } from "@/lib/badges";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export default async function LivePage() {
  const t = await getT();
  await requireRole(...STAFF);
  const supabase = await createClient();
  const today = cairoToday();
  const [dayStart] = cairoRange(today, today);
  const slowBefore = minutesAgo(30);

  const [activityRes, boardRes, teamsRes, breaksRes, waitingRes, talkRes] = await Promise.all([
    supabase.rpc("team_activity_today"),
    supabase.rpc("leaderboard", { p_from: today, p_to: today }),
    supabase.from("profiles").select("id, full_name, teams!profiles_team_id_fkey(name)").eq("role", "agent").eq("is_active", true),
    supabase.from("agent_breaks").select("agent_id, status, ends_at").in("status", ["pending", "active"]).gte("requested_at", dayStart),
    supabase.from("leads").select("agent_id, created_at").eq("status", "new").eq("attempts", 0).not("agent_id", "is", null).limit(5000),
    supabase.rpc("talk_time", { p_from: today, p_to: today }),
  ]);
  const talk = new Map(((talkRes.data ?? []) as { agent_id: string; minutes: number }[]).map((r) => [r.agent_id, r.minutes]));

  type Act = { agent_id: string; last_at: string | null; last_note: string | null };
  const activity = new Map(((activityRes.data ?? []) as Act[]).map((a) => [a.agent_id, a]));
  const board = new Map(((boardRes.data ?? []) as BoardRow[]).map((r) => [r.agent_id, r]));
  const teamName = new Map((teamsRes.data ?? []).map((p) => [p.id, (p.teams as unknown as { name: string } | null)?.name ?? null]));
  const breaks = breaksRes.data ?? [];
  const waiting = waitingRes.data ?? [];

  // team_activity_today already applies "who can I see", so it decides the roster.
  const agents: LiveAgent[] = [...activity.keys()].map((id) => {
    const b = board.get(id);
    const act = activity.get(id)!;
    const br = breaks.find((x) => x.agent_id === id && x.status === "active");
    const mine = waiting.filter((w) => w.agent_id === id);
    return {
      id,
      name: b?.full_name ?? "—",
      team: teamName.get(id) ?? null,
      points: b?.points ?? 0,
      leads: b?.leads ?? 0,
      calls: b?.calls ?? 0,
      hired: b?.hired ?? 0,
      streak: b?.streak ?? 0,
      lastAt: act.last_at,
      lastNote: act.last_note,
      breakEndsAt: br?.ends_at ?? null,
      breakPending: breaks.some((x) => x.agent_id === id && x.status === "pending"),
      waiting: mine.length,
      slow: mine.filter((w) => w.created_at < slowBefore).length,
      talkMin: talk.get(id) ?? 0,
    };
  });

  return (
    <>
      <LiveRefresh channel="admin-live" />
      <PageHeader title={t("المتابعة اللايف")} subtitle={t("مين شغال دلوقتي، مين في بريك، ومين واقف — بيتحدث لوحده")}>
        <Link href="/tv" target="_blank" className="btn-dark"><Tv size={17} /> {t("وضع شاشة المكتب")}</Link>
      </PageHeader>
      {agents.length === 0 ? <Empty>{t("مفيش أجنتس")}</Empty> : <LiveBoard agents={agents} base="/admin" />}
    </>
  );
}
