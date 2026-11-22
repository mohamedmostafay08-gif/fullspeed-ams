import { Coffee, Hourglass, History } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { ATTENDANCE_TABS, SubTabs } from "@/components/sub-tabs";
import { BreakDecision, Countdown } from "@/components/breaks";
import { LiveRefresh } from "@/components/live";
import { Empty, formatDate } from "@/components/ui";
import { cairoRange, cairoToday, requireRole, STAFF } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Row = {
  id: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  agent: { id: string; full_name: string } | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "مستني", cls: "bg-amber-100 text-amber-800" },
  active: { label: "في البريك", cls: "bg-teal-100 text-teal-800" },
  ended: { label: "خلص", cls: "bg-zinc-200 text-zinc-700" },
  rejected: { label: "اترفض", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "اتلغى", cls: "bg-zinc-100 text-zinc-500" },
};

function minutes(r: Row) {
  if (!r.started_at) return null;
  const end = r.ended_at ?? (r.ends_at && new Date(r.ends_at) < new Date() ? r.ends_at : new Date().toISOString());
  return Math.round((new Date(end).getTime() - new Date(r.started_at).getTime()) / 60000);
}

export default async function BreaksPage() {
  const t = await getT();
  await requireRole(...STAFF);
  const [start, end] = cairoRange(cairoToday(), cairoToday());
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_breaks")
    .select("id, status, requested_at, started_at, ends_at, ended_at, agent:profiles!agent_breaks_agent_id_fkey(id, full_name)")
    .gte("requested_at", start)
    .lt("requested_at", end)
    .order("requested_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];
  const now = new Date();
  const pending = rows.filter((r) => r.status === "pending");
  const active = rows.filter((r) => r.status === "active" && r.ends_at && new Date(r.ends_at) > now);

  return (
    <>
      <LiveRefresh channel="admin-breaks" />
      <PageHeader title={t("البريكات")} subtitle={t("كل أجنت ليه بريكين في اليوم — كل واحد نص ساعة")} />
      <SubTabs tabs={ATTENDANCE_TABS} current="/admin/breaks" />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card">
          <h2 className="card-title"><Hourglass size={18} className="text-amber-500" /> {t("طلبات مستنية موافقتك (")}{pending.length})</h2>
          {pending.length === 0 ? (
            <Empty icon={Coffee}>{t("مفيش طلبات دلوقتي")}</Empty>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pending.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{r.agent?.full_name}</p>
                    <p className="text-xs text-zinc-500">{t("طلب")} {formatDate(r.requested_at)}</p>
                  </div>
                  <BreakDecision id={r.id} mode="pending" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="card-title"><Coffee size={18} className="text-teal-600" /> {t("في البريك دلوقتي (")}{active.length})</h2>
          {active.length === 0 ? (
            <Empty icon={Coffee}>{t("محدش في بريك")}</Empty>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {active.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{r.agent?.full_name}</p>
                    <p className="text-xs text-teal-700">
                      {t("فاضل")} <Countdown endsAt={r.ends_at!} />
                    </p>
                  </div>
                  <BreakDecision id={r.id} mode="active" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-6">
        <h2 className="card-title"><History size={18} className="text-zinc-500" /> {t("سجل النهارده")}</h2>
        {rows.length === 0 ? (
          <Empty>{t("مفيش بريكات النهارده")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>{t("الأجنت")}</th><th>{t("الحالة")}</th><th>{t("الطلب")}</th><th>{t("البداية")}</th><th>{t("المدة")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const live = r.status === "active" && r.ends_at && new Date(r.ends_at) <= now ? "ended" : r.status;
                  const mins = minutes(r);
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.agent?.full_name}</td>
                      <td><span className={`badge ${STATUS[live].cls}`}>{t(STATUS[live].label)}</span></td>
                      <td className="text-xs text-zinc-500">{formatDate(r.requested_at)}</td>
                      <td className="text-xs text-zinc-500">{formatDate(r.started_at)}</td>
                      <td className="num text-sm">{mins == null ? "—" : t("{0} د", mins)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
