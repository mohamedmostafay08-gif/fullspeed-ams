import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { AGENT_WORK_TABS, SubTabs } from "@/components/sub-tabs";
import { MemoCard } from "@/components/memo-card";
import { Empty } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadMemosAndMarkRead } from "@/lib/memos";
import { getT } from "@/lib/i18n/server";

export default async function AgentMemosPage() {
  const t = await getT();
  const me = await requireRole("agent");
  const { memos, unread } = await loadMemosAndMarkRead(me.id);
  return (
    <>
      <PageHeader title={t("التعميمات")} subtitle={t("رسايل الإدارة والتيم ليدر ليك")} />
      <SubTabs tabs={AGENT_WORK_TABS} current="/agent/memos" />
      <div className="grid gap-4">
        {memos.length === 0 ? (
          <section className="card"><Empty icon={Megaphone}>{t("لسه مفيش تعميمات")}</Empty></section>
        ) : (
          memos.map((m) => <MemoCard key={m.id} memo={m} isNew={unread.has(m.id)} />)
        )}
      </div>
    </>
  );
}
