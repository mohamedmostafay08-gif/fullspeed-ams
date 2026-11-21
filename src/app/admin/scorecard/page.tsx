import { PageHeader } from "@/components/app-shell";
import { Scorecard, weekRange } from "@/components/scorecard";
import { Empty } from "@/components/ui";
import { STAFF, cairoToday, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export default async function AdminScorecardPage({ searchParams }: PageProps<"/admin/scorecard">) {
  const t = await getT();
  await requireRole(...STAFF);
  const sp = await searchParams;
  const which = sp.week === "current" ? "current" : "last";
  const supabase = await createClient();
  const { data: agents } = await supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name");
  const list = agents ?? [];
  const agentId = typeof sp.agent === "string" && list.some((a) => a.id === sp.agent) ? sp.agent : list[0]?.id;
  const [from, to] = weekRange(cairoToday(), which);

  return (
    <>
      <PageHeader title={t("التقييم الأسبوعي")} subtitle={t("أرقام كل أجنت مقارنة بمتوسط الفريق — وصل للأجنت نفسه كل سبت")}>
        <form className="flex items-center gap-2">
          <input type="hidden" name="week" value={which} />
          <select name="agent" defaultValue={agentId} className="input py-2 sm:w-56" aria-label={t("الأجنت")}>
            {list.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
          <button className="btn-ghost">{t("عرض")}</button>
        </form>
      </PageHeader>
      {agentId ? (
        <Scorecard agentId={agentId} from={from} to={to} link={(w) => `/admin/scorecard?agent=${agentId}&week=${w}`} />
      ) : (
        <section className="card"><Empty>{t("مفيش أجنتس")}</Empty></section>
      )}
    </>
  );
}
