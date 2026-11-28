import Link from "next/link";
import { rebalanceCompanyLeads } from "@/app/actions/assignment";
import { BulkLeadsBar } from "@/components/bulk-leads";
import { LeadsTable, type LeadRow } from "@/components/leads-table";
import { StateForm } from "@/components/state-form";
import { Empty } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { queryLeads, readFilters } from "@/lib/lead-query";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
type Load = { agent_id: string | null; name: string | null; linked: boolean; receives: boolean; untouched: number; open_n: number };

/**
 * «الليدز» tab of a company: who holds its leads, an even-out button, and the leads themselves with tick boxes
 * to move them to one of the company's agents.
 */
export async function CompanyLeadsTab({ companyId, sp, canDistribute }: { companyId: string; sp: Record<string, string | string[] | undefined>; canDistribute: boolean }) {
  const t = await getT();
  const supabase = await createClient();
  const agentParam = typeof sp.agent === "string" ? sp.agent : "";
  const f = { ...readFilters({ ...sp, company: companyId }), company: companyId };
  const [{ data: loadData, error }, { data: leads, count }] = await Promise.all([
    supabase.rpc("company_lead_load", { p_company: companyId }),
    queryLeads(f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
  ]);
  if (error) return <Empty>{t("التاب ده محتاج migration 0057 — اتأكد إنه اتطبق في Supabase")}</Empty>;

  const load = (loadData ?? []) as Load[];
  const linked = load.filter((r) => r.agent_id && r.linked);
  const receiving = linked.filter((r) => r.receives);
  const unassigned = load.find((r) => !r.agent_id);
  const strangers = load.filter((r) => r.agent_id && !r.linked && Number(r.open_n) > 0);
  const untouchedTotal = load.reduce((s, r) => s + Number(r.untouched), 0);
  const fair = receiving.length ? Math.ceil(untouchedTotal / receiving.length) : 0;
  const heaviest = [...receiving].sort((a, b) => Number(b.untouched) - Number(a.untouched))[0];
  const uneven = receiving.length > 1 && heaviest && Number(heaviest.untouched) > fair + 1;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const href = (agent: string, page = 1) => {
    const p = new URLSearchParams({ tab: "leads" });
    if (agent) p.set("agent", agent);
    if (page > 1) p.set("page", String(page));
    return `?${p}`;
  };
  const chip = (key: string, label: string, n: number, extra = "") => (
    <Link key={key} href={href(key)} className={`chip ${agentParam === key ? "border-(--fg) bg-(--fg) text-(--surface)" : ""} ${extra}`}>
      {label} <span className="num font-semibold">{n}</span>
    </Link>
  );

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-2 font-semibold">👥 {t("مين ماسك ليدز الشركة")}</h2>
          {chip("", t("الكل"), load.reduce((s, r) => s + Number(r.open_n), 0))}
          {chip("none", t("مش متوزعة"), Number(unassigned?.open_n ?? 0), Number(unassigned?.open_n ?? 0) ? "text-amber-700" : "")}
          {linked.map((r) => chip(r.agent_id!, r.name ?? "—", Number(r.open_n), r.receives ? "" : "opacity-60"))}
          {strangers.map((r) => chip(r.agent_id!, `${r.name ?? "—"} ⚠️`, Number(r.open_n)))}
        </div>
        {linked.length === 0 && (
          <p className="text-sm text-amber-700">{t("مفيش أجنتس متعينين على الشركة دي — علّمهم الأول من تاب «البيانات والأجنتس».")}</p>
        )}
        {strangers.length > 0 && (
          <p className="text-xs text-zinc-500">⚠️ {t("أجنتس ماسكين ليدز للشركة دي ومش متعينين عليها. «وزّع بالتساوي» بينقل ليدزهم اللي محدش كلمها لأجنتس الشركة.")}</p>
        )}

        {canDistribute && receiving.length > 0 && (
          <div className="rounded-xl bg-zinc-50 p-3">
            <p className="mb-2 text-sm">
              {uneven
                ? t("{0} ماسك {1} ليد محدش كلمها، والمفروض كل أجنت ياخد حوالي {2}.", heaviest!.name ?? "—", Number(heaviest!.untouched), fair)
                : t("الليدز اللي محدش كلمها ({0}) متوزعة على {1} أجنت.", untouchedTotal, receiving.length)}
            </p>
            <StateForm action={rebalanceCompanyLeads} submitLabel={t("وزّع بالتساوي على {0} أجنت", receiving.length)} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="company_id" value={companyId} />
              <label className="min-w-52 flex-1">
                <span className="label">{t("خُد الليدز من")}</span>
                <select name="from_agent" defaultValue={uneven ? heaviest!.agent_id! : ""} className="input">
                  <option value="">{t("كل الأجنتس (ساوي الكل)")}</option>
                  {load.filter((r) => r.agent_id && Number(r.untouched) > 0).map((r) => (
                    <option key={r.agent_id} value={r.agent_id!}>{t("{0} ({1} ليد محدش كلمها)", r.name ?? "—", Number(r.untouched))}</option>
                  ))}
                </select>
              </label>
            </StateForm>
            <p className="mt-2 text-xs text-zinc-500">{t("بيتنقل بس الليدز اللي محدش كلمها والمش متوزعة، وأي ليد اتشغل عليه بيفضل مع صاحبه. كل أجنت بيقف عند الحد الأقصى بتاعه، واللي زيادة بيرجع «مش متوزعة» لحد ما يبقى فيه مكان.")}</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold">📋 {t("ليدز الشركة")} <span className="num text-zinc-500">({count ?? 0})</span></h2>
        <p className="mb-3 text-xs text-zinc-500">{t("علّم الليدز اللي عايز تنقلها، واختار الأجنت من الشريط اللي تحت.")}</p>
        {(leads ?? []).length === 0 ? (
          <Empty>{t("مفيش ليدز هنا")}</Empty>
        ) : (
          <>
            <LeadsTable leads={(leads ?? []) as LeadRow[]} basePath="/admin/leads" showAgent selectable />
            <BulkLeadsBar agents={linked.map((a) => ({ id: a.agent_id!, name: a.name ?? "—" }))} />
          </>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {f.page > 1 && <Link className="btn-ghost" href={href(agentParam, f.page - 1)}>{t("السابق")}</Link>}
            <span className="text-zinc-500">{t("صفحة")} {f.page} {t("من")} {pages}</span>
            {f.page < pages && <Link className="btn-ghost" href={href(agentParam, f.page + 1)}>{t("التالي")}</Link>}
          </div>
        )}
      </section>
    </div>
  );
}
