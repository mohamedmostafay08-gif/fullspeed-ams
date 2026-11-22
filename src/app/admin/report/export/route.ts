import { NextResponse, type NextRequest } from "next/server";
import { VIEWERS, getProfile } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type Row = { agent_id: string; full_name: string; team_id: string | null; leads: number; calls: number; interviews: number; hired: number; points: number };

/** Per-agent performance for a period, as an Excel-friendly CSV. No lead names or phone numbers. */
export async function GET(request: NextRequest) {
  const t = await getT();
  const profile = await getProfile();
  if (!profile || !VIEWERS.includes(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return new NextResponse("Bad dates", { status: 400 });

  const supabase = await createClient();
  const db = profile.role === "performance" ? createAdminClient() : supabase;
  const [board, teams, talk] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: from, p_to: to }),
    supabase.from("teams").select("id, name"),
    db.rpc("talk_time", { p_from: from, p_to: to }),
  ]);
  const teamName = new Map((teams.data ?? []).map((x) => [x.id, x.name as string]));
  const talkMin = new Map(((talk.data ?? []) as { agent_id: string; minutes: number }[]).map((x) => [x.agent_id, x.minutes]));
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "");

  const rows = [
    [t("الأجنت"), t("التيم"), t("الليدز"), t("المكالمات"), t("دقايق الكلام"), t("المقابلات"), t("اشتغلوا"), t("نسبة التحويل"), t("النقط")],
    ...((board.data ?? []) as Row[]).map((r) => [
      r.full_name,
      r.team_id ? teamName.get(r.team_id) ?? "" : "",
      r.leads,
      r.calls,
      talkMin.get(r.agent_id) ?? "",
      r.interviews,
      r.hired,
      pct(r.hired, r.leads),
      r.points,
    ]),
  ];
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="performance-${from}_${to}.csv"`,
    },
  });
}
