import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { AGENT_WORK_TABS, SubTabs } from "@/components/sub-tabs";
import { MemoCard } from "@/components/memo-card";
import { Empty } from "@/components/ui";
import { getViewAs, requireAgent } from "@/lib/view-as";
import { loadMemosAndMarkRead } from "@/lib/memos";
import { getT } from "@/lib/i18n/server";

export default async function AgentMemosPage() {
  const t = await getT();
  const me = await requireAgent();
  const viewing = Boolean(await getViewAs());
  const loaded = await loadMemosAndMarkRead(me.id, 50, !viewing);
  // The admin reads every memo; show only what reaches this agent (everyone + their team).
  const memos = viewing ? loaded.memos.filter((m) => !m.team_id || m.team_id === me.team_id) : loaded.memos;
  const { unread } = loaded;
  return (
    <>
      <PageHeader title={t("المطلوب مني")} subtitle={t("رسايل الإدارة والتيم ليدر ليك")} />
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
