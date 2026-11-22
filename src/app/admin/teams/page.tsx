import Link from "next/link";
import { redirect } from "next/navigation";
import { Network, Trophy } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { PeriodTabs } from "@/components/period-tabs";
import { Empty } from "@/components/ui";
import { requireRole, VIEWERS } from "@/lib/auth";
import { asPeriod, loadTeamNumbers, periodRange } from "@/lib/teams";
import { getT } from "@/lib/i18n/server";

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");

export default async function TeamsPage({ searchParams }: PageProps<"/admin/teams">) {
  const t = await getT();
  const me = await requireRole(...VIEWERS);
  // A team leader goes straight to their own team.
  if (me.role === "team_leader") redirect(me.team_id ? `/admin/teams/${me.team_id}` : "/admin");
  const period = asPeriod((await searchParams).period);
  const [from, to] = periodRange(period);
  const { teams } = await loadTeamNumbers(from, to);

  return (
    <>
      <PageHeader title={t("التيمات")} subtitle={t("مقارنة التيمات — مرتبين بعدد التعيينات")}>
        <PeriodTabs current={period} href={(p) => `/admin/teams?period=${p}`} />
      </PageHeader>
      <section className="card md:overflow-x-auto">
        <h2 className="card-title"><Trophy size={18} className="text-amber-500" /> {t("ترتيب التيمات")}</h2>
        {teams.length === 0 ? (
          <Empty icon={Network}>{t("لسه مفيش تيمات — اعملها من صفحة «الفريق»")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th><th>{t("التيم")}</th><th>{t("التيم ليدر")}</th><th>{t("الأجنتس")}</th><th>{t("الليدز")}</th>
                  <th>{t("المكالمات")}</th><th>{t("المقابلات")}</th><th>{t("اشتغلوا")}</th><th>{t("تارجت التعيين")}</th><th>{t("المحقق")}</th><th>{t("النقط")}</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((row, i) => (
                  <tr key={row.id}>
                    <td className="num font-bold">{i + 1}</td>
                    <td className="font-semibold"><Link href={`/admin/teams/${row.id}?period=${period}`} className="hover:underline">{row.name}</Link></td>
                    <td className="text-sm">{row.leader ?? "—"}</td>
                    <td className="num">{row.agents}</td>
                    <td className="num">{row.leads}</td>
                    <td className="num">{row.calls}</td>
                    <td className="num">{row.interviews}</td>
                    <td className="num font-bold text-emerald-700">{row.hired}</td>
                    <td className="num">{row.targetHired || "—"}</td>
                    <td className="num">{pct(row.hired, row.targetHired)}</td>
                    <td className="num">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
