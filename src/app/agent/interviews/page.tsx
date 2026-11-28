import { PageHeader } from "@/components/app-shell";
import { InterviewBoard } from "@/components/interview-board";
import { getT } from "@/lib/i18n/server";
import { getViewAs, requireAgent } from "@/lib/view-as";

export default async function AgentInterviewsPage({ searchParams }: PageProps<"/agent/interviews">) {
  const t = await getT();
  const agent = await requireAgent();
  const viewing = Boolean(await getViewAs());
  return (
    <>
      <PageHeader title={t("مقابلاتي")} subtitle={t("بعد كل مقابلة سجّل حضر ولا مجاش")} />
      <InterviewBoard base="/agent/interviews" sp={await searchParams} staff={false} agentId={agent.id} readOnly={viewing} />
    </>
  );
}
