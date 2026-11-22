import { PageHeader } from "@/components/app-shell";
import { RangePicker, readRange } from "@/components/range-picker";
import { Scorecard } from "@/components/scorecard";
import { requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export default async function AgentScorecardPage({ searchParams }: PageProps<"/agent/scorecard">) {
  const t = await getT();
  const me = await requireRole("agent");
  const [from, to] = readRange(await searchParams);
  return (
    <>
      <PageHeader title={t("تقييمي")} subtitle={t("أرقامك مقارنة بمتوسط الفريق — عشان تعرف تتحسن في إيه")} />
      <RangePicker path="/agent/scorecard" from={from} to={to} />
      <Scorecard agentId={me.id} from={from} to={to} />
    </>
  );
}
