import Link from "next/link";
import { saveCompanyAgents } from "@/app/admin/actions";
import { distributeUnassigned } from "@/app/actions/assignment";
import { PageHeader } from "@/components/app-shell";
import { StateForm } from "@/components/state-form";
import { ASSIGN_TABS, SubTabs } from "@/components/sub-tabs";
import { CompanyLogo, Empty } from "@/components/ui";
import { MANAGERS, STAFF, requireRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Row = { company_id: string; company: string; logo_path: string | null; unassigned: number; agents: { id: string; name: string; receives: boolean }[] };

/**
 * «وزّع الليدز»: one card per company. Tick the agents who work on it, then hand its waiting leads to them in one click.
 * The same links feed the automatic distribution of every new lead.
 */
export default async function AssignPage() {
  const t = await getT();
  const me = await requireRole(...STAFF);
  const canDistribute = MANAGERS.includes(me.role);
  const supabase = await createClient();
  const [{ data, error }, { data: agents }] = await Promise.all([
    supabase.rpc("distribution_board"),
    supabase.from("profiles").select("id, full_name").eq("role", "agent").eq("is_active", true).order("full_name"),
  ]);

  const header = (
    <PageHeader title={t("التوزيع")} subtitle={t("علّم الأجنتس اللي بيشتغلوا على كل شركة، وبعدين وزّع الليدز المستنية عليهم بضغطة")} />
  );
  const tabs = <SubTabs tabs={ASSIGN_TABS} current="/admin/assign" role={me.role} />;
  if (error || !data) {
    return (
      <>
        {header}
        {tabs}
        <Empty>{t("الصفحة دي محتاجة migration 0054 — اتأكد إنه اتطبق في Supabase")}</Empty>
      </>
    );
  }

  const rows = data as Row[];
  const total = rows.reduce((s, r) => s + Number(r.unassigned), 0);
  const ready = rows.filter((r) => r.unassigned > 0 && r.agents.some((a) => a.receives)).reduce((s, r) => s + Number(r.unassigned), 0);
  const noAgents = rows.filter((r) => r.agents.length === 0).length;
  const all = agents ?? [];

  return (
    <>
      {header}
      {tabs}

      <section className="card mb-6 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div>
          <p className="text-sm text-zinc-500">{t("ليدز مستنية أجنت")}</p>
          <p className={`num text-4xl font-semibold ${total ? "text-amber-600" : ""}`}>{total}</p>
        </div>
        <div className="min-w-0 flex-1 text-sm text-zinc-600">
          {noAgents > 0 && <p>⚠️ {t("{0} شركة مالهاش أجنتس — ليدزها مش هتتوزع لحد ما تعلّم أجنتس عليها تحت.", noAgents)}</p>}
          {ready > 0 && <p>✅ {t("{0} ليد جاهزين يتوزعوا دلوقتي على الأجنتس المربوطين.", ready)}</p>}
          {total === 0 && <p>🎉 {t("كل الليدز متوزعة.")}</p>}
        </div>
        {canDistribute && ready > 0 && (
          <StateForm action={distributeUnassigned} submitLabel={t("وزّع الـ {0} كلهم", ready)} className="flex items-center gap-2">{null}</StateForm>
        )}
      </section>

      {rows.length === 0 ? (
        <Empty>{t("مفيش شركات شغالة")}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((r) => {
            const linked = new Set(r.agents.map((a) => a.id));
            const receiving = r.agents.filter((a) => a.receives).length;
            return (
              <article key={r.company_id} className={`card flex flex-col gap-4 ${r.agents.length === 0 ? "ring-2 ring-amber-200" : ""}`}>
                <div className="flex items-center gap-3">
                  <CompanyLogo name={r.company} src={r.logo_path} size={42} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/companies/${r.company_id}?tab=setup`} className="block truncate font-bold hover:text-brand-700">{r.company}</Link>
                    <p className="text-xs text-zinc-500">
                      {r.agents.length === 0 ? t("مفيش أجنتس لسه") : t("{0} أجنت · {1} بيستلموا ليدز", r.agents.length, receiving)}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className={`num text-2xl font-semibold ${r.unassigned ? "text-amber-600" : "text-zinc-400"}`}>{r.unassigned}</p>
                    <p className="text-[11px] text-zinc-500">{t("مستنيين")}</p>
                  </div>
                </div>

                <details open={r.agents.length === 0} className="group rounded-xl bg-zinc-50 p-3">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                    👥 {t("الأجنتس")}
                    <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                      {r.agents.slice(0, 6).map((a) => (
                        <span key={a.id} className={`badge ${a.receives ? "bg-white text-zinc-700 ring-1 ring-zinc-200" : "bg-zinc-100 text-zinc-400 line-through"}`}>{a.name}</span>
                      ))}
                      {r.agents.length > 6 && <span className="badge bg-white text-zinc-500">+{r.agents.length - 6}</span>}
                    </span>
                    <span className="text-xs text-brand-700 group-open:hidden">{t("تعديل")}</span>
                  </summary>
                  <StateForm action={saveCompanyAgents} submitLabel={t("احفظ الأجنتس")} className="mt-3 space-y-3">
                    <input type="hidden" name="company_id" value={r.company_id} />
                    {[...linked].map((id) => <input key={id} type="hidden" name="was" value={id} />)}
                    {all.length === 0 ? (
                      <p className="text-sm text-zinc-500">{t("مفيش أجنتس نشطين")}</p>
                    ) : (
                      <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                        {all.map((a) => (
                          <label key={a.id} className="chip cursor-pointer has-checked:border-(--fg) has-checked:bg-(--fg) has-checked:text-(--surface)">
                            <input type="checkbox" name="agent_id" value={a.id} defaultChecked={linked.has(a.id)} className="sr-only" />
                            {a.full_name}
                          </label>
                        ))}
                      </div>
                    )}
                  </StateForm>
                </details>

                {r.agents.length > 0 && (
                  <Link href={`/admin/companies/${r.company_id}?tab=leads`} className="text-xs font-semibold text-brand-700 hover:underline">
                    {t("ليدز الشركة ومين ماسكها ←")}
                  </Link>
                )}
                {canDistribute && r.unassigned > 0 && receiving > 0 && (
                  <StateForm action={distributeUnassigned} submitLabel={t("وزّع الـ {0} على {1} أجنت", r.unassigned, receiving)} className="mt-auto">
                    <input type="hidden" name="company_id" value={r.company_id} />
                  </StateForm>
                )}
                {r.unassigned > 0 && r.agents.length > 0 && receiving === 0 && (
                  <p className="mt-auto text-xs text-amber-700">{t("كل أجنتس الشركة دي واقفين عن استلام الليدز — شغّلهم من «القواعد والمهلة».")}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
