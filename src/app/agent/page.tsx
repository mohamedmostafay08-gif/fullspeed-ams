import Link from "next/link";
import { BellRing, CheckCircle2, ClipboardList, Flame, Plus, Trophy, UserPlus } from "lucide-react";
import { TargetCelebration } from "@/components/celebrate";
import { DeviceSetupBanner } from "@/components/pwa";
import { getPushPublicKey } from "@/lib/push";
import type { AgentStats, BoardRow } from "@/lib/badges";
import { NextCall } from "@/components/next-call";
import { TodayQueue } from "@/components/today-queue";
import { PageHeader } from "@/components/app-shell";
import { BreakChip, type BreakRow } from "@/components/breaks";
import { LiveRefresh } from "@/components/live";
import { StatCard } from "@/components/ui";
import { cairoRange, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type PerfRow = { company_id: string; leads_count: number; hired_count: number; target_leads: number; target_hired: number };

/**
 * The agent's day, in the order the work happens: the next call, today's queue, then three numbers.
 * Companies live on /agent/companies, the leaderboard and badges on /agent/scorecard, tasks on /agent/tasks.
 */
export default async function AgentHome() {
  const t = await getT();
  const profile = await requireRole("agent");
  const today = cairoToday();
  const supabase = await createClient();
  const [dayStart, dayEnd] = cairoRange(today, today);
  const [perfRes, tasksRes, followRes, breaksRes, boardRes, statsRes, pushKey, passkeysRes] = await Promise.all([
    supabase.rpc("performance_report", { p_from: today, p_to: today, p_agent: profile.id }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("agent_id", profile.id).in("status", ["pending", "in_progress"]),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("agent_id", profile.id).in("status", ["new", "no_answer"]),
    supabase
      .from("agent_breaks")
      .select("id, status, requested_at, started_at, ends_at")
      .eq("agent_id", profile.id)
      .gte("requested_at", dayStart)
      .lt("requested_at", dayEnd)
      .order("requested_at"),
    supabase.rpc("leaderboard", { p_from: today, p_to: today }),
    supabase.rpc("agent_stats", { p_agent: profile.id }),
    getPushPublicKey(),
    supabase.from("passkeys").select("id", { count: "exact", head: true }),
  ]);

  const perf = (perfRes.data ?? []) as PerfRow[];
  const sum = (k: keyof PerfRow) => perf.reduce((s, r) => s + Number(r[k]), 0);
  const board = (boardRes.data ?? []) as BoardRow[];
  const myRank = board.findIndex((r) => r.agent_id === profile.id) + 1 || null;
  const myPoints = board.find((r) => r.agent_id === profile.id)?.points ?? 0;
  const streak = (statsRes.data as AgentStats | null)?.streak ?? 0;
  const openTasks = tasksRes.count ?? 0;

  return (
    <>
      <LiveRefresh channel={`agent-${profile.id}`} />
      <TargetCelebration
        userId={profile.id}
        day={today}
        leads={sum("leads_count")}
        leadsTarget={sum("target_leads")}
        hired={sum("hired_count")}
        hiredTarget={sum("target_hired")}
      />
      <DeviceSetupBanner publicKey={pushKey} hasPasskey={(passkeysRes.count ?? 0) > 0} />
      <PageHeader title={t("صباح الفل يا {0}", profile.full_name.split(" ")[0])} subtitle={today}>
        {streak > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-2 text-sm font-bold text-orange-700" title={t("{0} يوم ورا بعض محقق هدفه", streak)}>
            <Flame size={16} /> {t("{0} يوم", streak)}
          </span>
        )}
        {myRank && myPoints > 0 && (
          <Link href="/agent/scorecard" className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200">
            <Trophy size={16} /> {t("ترتيبك #{0} · {1} نقطة", myRank, myPoints)}
          </Link>
        )}
        <BreakChip today={(breaksRes.data ?? []) as BreakRow[]} />
        <Link href="/agent/leads/new" className="btn-ghost">
          <Plus size={18} /> {t("ليد جديد")}
        </Link>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <NextCall agentId={profile.id} agentName={profile.full_name} />
          <TodayQueue agentId={profile.id} />
        </div>

        <aside className="stagger grid h-fit grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <StatCard label={t("ليدز النهارده")} value={sum("leads_count")} icon={UserPlus} progress={{ value: sum("leads_count"), target: sum("target_leads") }} />
          <StatCard label={t("اشتغلوا")} value={sum("hired_count")} tone="good" icon={CheckCircle2} progress={{ value: sum("hired_count"), target: sum("target_hired") }} />
          <StatCard label={t("محتاجين متابعة")} value={followRes.count ?? 0} tone="brand" icon={BellRing} hint={t("جديد + مردش")} />
          {openTasks > 0 && (
            <Link href="/agent/tasks" className="col-span-full flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              <ClipboardList size={18} /> {t("عندك {0} تاسك مفتوح", openTasks)}
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}
