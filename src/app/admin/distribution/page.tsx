import Link from "next/link";
import { Clock, Shuffle, Timer, UserX, Zap } from "lucide-react";
import { saveAgentReceiving, saveAssignmentSettings } from "@/app/actions/assignment";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { Empty, StatCard, formatDate } from "@/components/ui";
import { MANAGERS, VIEWERS, requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Settings = { skip_unavailable: boolean; online_minutes: number; max_open_default: number; reassign_minutes: number; max_reassigns: number };
type Kpi = { handed: number; contacted: number; within15: number; median_first_min: number | null; timeout_moves: number; manual_moves: number; overdue_now: number; unassigned_now: number | null };
type Agent = {
  id: string; full_name: string; team_name: string | null; receives_leads: boolean; max_open_leads: number | null;
  open_n: number; received: number; contacted: number; median_first_min: number | null; moved_away: number;
  state: "available" | "break" | "leave" | "offline"; last_seen: string | null;
};
type Move = { lead_id: string; lead_name: string | null; reason: "manual" | "timeout" | "auto"; created_at: string; from_name: string | null; to_name: string | null };
type Overview = { settings: Settings; kpi: Kpi; agents: Agent[]; recent: Move[] };

const PERIODS = [1, 7, 30] as const;
const STATE: Record<Agent["state"], { label: string; cls: string }> = {
  available: { label: "متاح", cls: "bg-emerald-100 text-emerald-800" },
  break: { label: "في بريك", cls: "bg-amber-100 text-amber-800" },
  leave: { label: "في إجازة", cls: "bg-sky-100 text-sky-800" },
  offline: { label: "مش فاتح السيستم", cls: "bg-zinc-100 text-zinc-500" },
};
const REASON: Record<Move["reason"], string> = { manual: "يدوي", timeout: "عدّى المهلة", auto: "أوتوماتيك" };

/** Who gets the new leads, the follow-up timeout, and how fast the first call happens. Ideas from LineCRM's assignment rules. */
export default async function DistributionPage({ searchParams }: PageProps<"/admin/distribution">) {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  const canEditRules = MANAGERS.includes(me.role);
  const canEditAgents = canEditRules || me.role === "team_leader";
  const sp = await searchParams;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 7;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assignment_overview", { p_days: days });
  if (error || !data) {
    return (
      <>
        <PageHeader title={t("التوزيع والمهلة")} />
        <Empty>{t("الصفحة دي محتاجة migration 0050 — اتأكد إنه اتطبق في Supabase")}</Empty>
      </>
    );
  }
  const o = data as Overview;
  const s = o.settings;
  const k = o.kpi;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const mins = (m: number | null) => (m === null || m === undefined ? "—" : m < 60 ? t("{0} د", m) : t("{0} س {1} د", Math.floor(m / 60), m % 60));

  return (
    <>
      <PageHeader
        title={t("التوزيع والمهلة")}
        subtitle={t("مين بياخد الليدز الجديدة، وإمتى الليد يتحول لزميل لو محدش كلّمه، وأد إيه بنلحق أول مكالمة")}
      >
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
          {PERIODS.map((d) => (
            <Link key={d} href={`/admin/distribution?days=${d}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${d === days ? "bg-white shadow-sm" : "text-zinc-500"}`}>
              {d === 1 ? t("النهارده") : t("آخر {0} يوم", d)}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t("ليدز اتوزعت")} value={k.handed} icon={Shuffle} hint={t("{0} اتكلموا", k.contacted)} />
        <StatCard label={t("وسيط أول تواصل")} value={mins(k.median_first_min)} icon={Timer} hint={t("من دخول الليد لأول مكالمة")} />
        <StatCard label={t("اتكلموا في ربع ساعة")} value={`${pct(k.within15, k.handed)}%`} icon={Zap} tone="good" hint={t("{0} من {1}", k.within15, k.handed)} />
        <StatCard label={t("متأخرين دلوقتي")} value={k.overdue_now} icon={Clock} tone={k.overdue_now > 0 ? "warn" : "default"} hint={t("ليد جديد محدش لمسه")} />
        <StatCard label={t("اتحولوا بعد المهلة")} value={k.timeout_moves} icon={UserX} hint={t("و{0} تحويل يدوي", k.manual_moves)} />
      </div>
      {k.unassigned_now ? (
        <p className="card mb-6 border-amber-200 bg-amber-50 text-sm text-amber-900">
          {t("فيه {0} ليد من غير أجنت في آخر يومين — اربط أجنتس بالشركات من", k.unassigned_now)}{" "}
          <Link href="/admin/agents/assign" className="font-semibold underline">{t("توزيع الشركات على الأجنتس")}</Link>
        </p>
      ) : null}

      <section className="card mb-6">
        <h2 className="mb-1 text-lg font-semibold">{t("قواعد التوزيع")}</h2>
        <p className="mb-4 text-sm text-zinc-500">
          {t("الليد الجديد بيروح للأجنت المتاح الأول، واللي لسه تحت الحد، وبعدين اللي معاه أقل ليدز النهارده. لو مفيش حد متاح، بيروح لأي حد بيستلم عشان ميفضلش من غير أجنت.")}
        </p>
        {canEditRules ? (
          <StateForm action={saveAssignmentSettings} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex items-start gap-2 text-sm font-medium sm:col-span-full">
              <input type="checkbox" name="skip_unavailable" defaultChecked={s.skip_unavailable} className="mt-1 accent-brand-600" />
              <span>
                {t("عدّي اللي مش متاح")}
                <span className="block text-xs font-normal text-zinc-500">{t("اللي في بريك أو إجازة أو إذن خروج، أو مفتحش السيستم في آخر كام دقيقة")}</span>
              </span>
            </label>
            <label className="text-sm font-medium">
              {t("يعتبر «فاتح السيستم» لو آخر حركة من (دقيقة)")}
              <input name="online_minutes" type="number" min={0} max={600} defaultValue={s.online_minutes} className="input mt-1" />
              <span className="text-xs font-normal text-zinc-500">{t("0 = متشترطش إنه فاتح")}</span>
            </label>
            <label className="text-sm font-medium">
              {t("أقصى عدد ليدز مفتوحة لكل أجنت")}
              <input name="max_open_default" type="number" min={0} max={10000} defaultValue={s.max_open_default} className="input mt-1" />
              <span className="text-xs font-normal text-zinc-500">{t("0 = من غير حد. الحد الخاص بالأجنت تحت بيغلب")}</span>
            </label>
            <label className="text-sm font-medium">
              {t("مهلة أول مكالمة قبل التحويل (دقيقة)")}
              <input name="reassign_minutes" type="number" min={0} max={1440} defaultValue={s.reassign_minutes} className="input mt-1" />
              <span className="text-xs font-normal text-zinc-500">{t("0 = التحويل مقفول. بيشتغل من 9 الصبح لـ 10 بالليل بس")}</span>
            </label>
            <label className="text-sm font-medium">
              {t("أقصى عدد مرات تحويل لليد الواحد")}
              <input name="max_reassigns" type="number" min={1} max={5} defaultValue={s.max_reassigns} className="input mt-1" />
            </label>
          </StateForm>
        ) : (
          <ul className="grid gap-1 text-sm text-zinc-600">
            <li>{s.skip_unavailable ? t("✓ بيعدّي اللي مش متاح") : t("✗ مش بيعدّي اللي مش متاح")}</li>
            <li>{s.max_open_default ? t("الحد الأقصى: {0} ليد مفتوح", s.max_open_default) : t("من غير حد أقصى")}</li>
            <li>{s.reassign_minutes ? t("التحويل بعد {0} دقيقة من غير مكالمة", s.reassign_minutes) : t("التحويل بعد المهلة مقفول")}</li>
          </ul>
        )}
      </section>

      <section className="card mb-6 overflow-x-auto">
        <h2 className="mb-3 text-lg font-semibold">{t("الأجنتس دلوقتي")}</h2>
        {o.agents.length === 0 ? (
          <Empty>{t("مفيش أجنتس")}</Empty>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-start text-xs text-zinc-500">
              <tr>
                <th className="p-2 text-start">{t("الأجنت")}</th>
                <th className="p-2 text-start">{t("الحالة")}</th>
                <th className="p-2 text-start">{t("مفتوح")}</th>
                <th className="p-2 text-start">{t("استلم")}</th>
                <th className="p-2 text-start">{t("اتكلموا")}</th>
                <th className="p-2 text-start">{t("وسيط أول تواصل")}</th>
                <th className="p-2 text-start">{t("اتحولوا منه")}</th>
                <th className="p-2 text-start">{t("بيستلم / الحد")}</th>
              </tr>
            </thead>
            <tbody>
              {o.agents.map((a) => (
                <tr key={a.id} className="border-t border-zinc-100 align-middle">
                  <td className="p-2">
                    <Link href={`/admin/agents/${a.id}`} className="font-semibold hover:underline">{a.full_name}</Link>
                    {a.team_name && <span className="block text-xs text-zinc-500">{a.team_name}</span>}
                  </td>
                  <td className="p-2">
                    <span className={`badge ${STATE[a.state].cls}`}>{t(STATE[a.state].label)}</span>
                    {a.last_seen && <span className="block text-xs text-zinc-400">{t("آخر حركة")} {formatDate(a.last_seen)}</span>}
                  </td>
                  <td className="num p-2">{a.open_n}{(a.max_open_leads ?? s.max_open_default) ? <span className="text-zinc-400"> / {a.max_open_leads ?? s.max_open_default}</span> : null}</td>
                  <td className="num p-2">{a.received}</td>
                  <td className="num p-2">{a.contacted} <span className="text-xs text-zinc-400">({pct(a.contacted, a.received)}%)</span></td>
                  <td className="num p-2">{mins(a.median_first_min)}</td>
                  <td className="num p-2">{a.moved_away || "—"}</td>
                  <td className="p-2">
                    {canEditAgents ? (
                      <StateForm action={saveAgentReceiving} className="flex flex-wrap items-center gap-2" submitLabel={t("حفظ")}>
                        <input type="hidden" name="agent_id" value={a.id} />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="receives" defaultChecked={a.receives_leads} className="accent-brand-600" /> {t("بيستلم")}
                        </label>
                        <input name="max_open" type="number" min={0} max={10000} defaultValue={a.max_open_leads ?? ""} placeholder={t("الحد")} aria-label={t("الحد")} className="input w-20 py-1" />
                      </StateForm>
                    ) : (
                      <span className="text-xs">{a.receives_leads ? t("بيستلم") : t("مش بيستلم")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("آخر التحويلات")}</h2>
        {o.recent.length === 0 ? (
          <Empty>{t("مفيش تحويلات في الفترة دي")}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {o.recent.map((m, i) => (
              <li key={`${m.lead_id}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                {m.lead_name ? <Link href={`/admin/leads/${m.lead_id}`} className="font-semibold hover:underline">{m.lead_name}</Link> : <span className="text-zinc-400">{t("ليد")}</span>}
                <span className="text-zinc-500">{m.from_name ?? "—"} ← {m.to_name ?? "—"}</span>
                <span className={`badge ${m.reason === "timeout" ? "bg-rose-100 text-rose-700" : "bg-zinc-100 text-zinc-600"}`}>{t(REASON[m.reason])}</span>
                <span className="ms-auto text-xs text-zinc-400">{formatDate(m.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
