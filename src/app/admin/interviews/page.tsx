import { PageHeader } from "@/components/app-shell";
import { InterviewBoard } from "@/components/interview-board";
import { requireRole, STAFF } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export default async function AdminInterviewsPage({ searchParams }: PageProps<"/admin/interviews">) {
  const t = await getT();
  await requireRole(...STAFF);
  return (
    <>
      <PageHeader title={t("المقابلات")} subtitle={t("مين جاي النهارده وبكرة، وسجّل حضر ولا مجاش — اللي مجاش بيرجع للأجنت يحدد معاد تاني")} />
      <InterviewBoard base="/admin/interviews" sp={await searchParams} staff />
    </>
  );
}
