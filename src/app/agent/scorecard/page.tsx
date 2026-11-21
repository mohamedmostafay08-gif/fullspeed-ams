import { PageHeader } from "@/components/app-shell";
import { Scorecard, weekRange } from "@/components/scorecard";
import { cairoToday, requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export default async function AgentScorecardPage({ searchParams }: PageProps<"/agent/scorecard">) {
  const t = await getT();
  const me = await requireRole("agent");
  const which = (await searchParams).week === "current" ? "current" : "last";
  const [from, to] = weekRange(cairoToday(), which);
  return (
    <>
      <PageHeader title={t("تقييمي الأسبوعي")} subtitle={t("أرقامك مقارنة بمتوسط الفريق — عشان تعرف تتحسن في إيه")} />
      <Scorecard agentId={me.id} from={from} to={to} link={(w) => `/agent/scorecard?week=${w}`} />
    </>
  );
}
