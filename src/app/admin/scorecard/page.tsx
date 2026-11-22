import { PageHeader } from "@/components/app-shell";
import { RangePicker, readRange } from "@/components/range-picker";
import { Scorecard } from "@/components/scorecard";
import { Empty } from "@/components/ui";
import { STAFF, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AdminScorecardPage({ searchParams }: PageProps<"/admin/scorecard">) {
  const t = await getT();
  await requireRole(...STAFF);
  const sp = await searchParams;
  const [from, to] = readRange(sp);
  const supabase = await createClient();
  const { data: agents } = await supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name");
  const list = agents ?? [];
  const agentId = typeof sp.agent === "string" && list.some((a) => a.id === sp.agent) ? sp.agent : list[0]?.id;

  return (
    <>
      <PageHeader title={t("التقييم")} subtitle={t("أرقام كل أجنت مقارنة بمتوسط الفريق في أي فترة تختارها")}>
        <form className="flex items-center gap-2">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <select name="agent" defaultValue={agentId} className="input py-2 sm:w-56" aria-label={t("الأجنت")}>
            {list.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
          <button className="btn-ghost">{t("عرض")}</button>
        </form>
      </PageHeader>
      <RangePicker path="/admin/scorecard" from={from} to={to} keep={agentId ? { agent: agentId } : {}} />
      {agentId ? (
        <Scorecard agentId={agentId} from={from} to={to} />
      ) : (
        <section className="card"><Empty>{t("مفيش أجنتس")}</Empty></section>
      )}
    </>
  );
}
