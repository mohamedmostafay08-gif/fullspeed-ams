"use client";

import { useActionState, useMemo, useState } from "react";
import { saveBulkAssignments } from "@/app/admin/actions";
import { CompanyLogo } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

type Agent = { id: string; name: string; team: string | null; teamId: string | null; active: boolean };
type Co = { id: string; name: string; logo: string | null };

const key = (agent: string, company: string) => `${agent}:${company}`;

/** Agents down the side, companies across the top; save sends only the agents that changed. */
export function AssignMatrix({
  agents,
  companies,
  assigned,
  teamCompanies,
  canAddToTeam,
}: {
  agents: Agent[];
  companies: Co[];
  assigned: Record<string, string[]>;
  teamCompanies: Record<string, string[]>;
  canAddToTeam: boolean;
}) {
  const t = useT();
  const initial = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) for (const c of assigned[a.id] ?? []) s.add(key(a.id, c));
    return s;
  }, [agents, assigned]);
  const [checked, setChecked] = useState<Set<string>>(initial);
  const [state, formAction, pending] = useActionState(saveBulkAssignments, undefined);

  // After a save the page data refreshes; start again from what the server now has.
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setChecked(new Set(initial));
  }

  const inTeam = (a: Agent, c: string) => !a.teamId || (teamCompanies[a.teamId] ?? []).includes(c);
  // A team leader may only tick the team's companies; a manager's tick also adds it to the team.
  const allowed = (a: Agent, c: string) => canAddToTeam || inTeam(a, c);

  const changedAgents = agents.filter((a) => companies.some((c) => checked.has(key(a.id, c.id)) !== initial.has(key(a.id, c.id))));
  // Keep companies outside the visible columns (e.g. inactive ones) as they are.
  const visible = new Set(companies.map((c) => c.id));
  const changes = changedAgents.map((a) => ({
    agent_id: a.id,
    company_ids: [
      ...companies.filter((c) => checked.has(key(a.id, c.id))).map((c) => c.id),
      ...(assigned[a.id] ?? []).filter((c) => !visible.has(c)),
    ],
  }));
  const newTeamLinks = canAddToTeam
    ? changedAgents.reduce((n, a) => n + companies.filter((c) => checked.has(key(a.id, c.id)) && !inTeam(a, c.id)).length, 0)
    : 0;

  const toggle = (a: Agent, c: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const k = key(a.id, c);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const setMany = (pairs: [Agent, string][], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const [a, c] of pairs) {
        if (!allowed(a, c)) continue;
        if (on) next.add(key(a.id, c));
        else next.delete(key(a.id, c));
      }
      return next;
    });
  const rowAll = (a: Agent) => companies.every((c) => !allowed(a, c.id) || checked.has(key(a.id, c.id)));
  const colAll = (c: string) => agents.every((a) => !allowed(a, c) || checked.has(key(a.id, c)));

  return (
    <form action={formAction} className="card space-y-3" aria-busy={pending}>
      <input type="hidden" name="changes" value={JSON.stringify(changes)} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending || changes.length === 0}>
          {pending ? t("جاري...") : t("حفظ التوزيع ({0} أجنت)", changes.length)}
        </button>
        {changes.length > 0 && !pending && (
          <button type="button" className="btn-ghost" onClick={() => setChecked(new Set(initial))}>{t("رجّع زي ما كان")}</button>
        )}
        {state?.error && <p role="alert" className="text-sm font-semibold text-rose-600">⚠️ {t(state.error)}</p>}
        {state?.ok && changes.length === 0 && <p role="status" className="text-sm font-semibold text-emerald-600">{t(state.ok)}</p>}
      </div>
      {newTeamLinks > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          {t("{0} من اللي علّمت عليهم مش من شركات تيم الأجنت — هتتضاف لشركات التيم أوتوماتيك لما تحفظ.", newTeamLinks)}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        {canAddToTeam
          ? t("الخانة المنقطة = الشركة مش من شركات تيم الأجنت لسه. دوس على اسم الشركة أو الأجنت عشان تعلّم على الكل.")
          : t("بتظهر شركات تيمك بس. دوس على اسم الشركة أو الأجنت عشان تعلّم على الكل.")}
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-zinc-200">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky start-0 top-0 z-20 bg-(--surface) p-2 text-start">{t("الأجنت")}</th>
              {companies.map((c) => (
                <th key={c.id} className="sticky top-0 z-10 bg-(--surface) p-1 align-bottom">
                  <button
                    type="button"
                    onClick={() => setMany(agents.map((a) => [a, c.id] as [Agent, string]), !colAll(c.id))}
                    className="flex w-20 flex-col items-center gap-1 rounded-lg p-1 text-[11px] font-semibold leading-tight hover:bg-zinc-100"
                    title={t("علّم على الكل / شيل الكل")}
                  >
                    <CompanyLogo name={c.name} src={c.logo} size={24} />
                    <span className="line-clamp-2 text-center">{c.name}</span>
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-10 bg-(--surface) p-2 text-xs">{t("العدد")}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const dirty = changedAgents.includes(a);
              const count = companies.filter((c) => checked.has(key(a.id, c.id))).length;
              return (
                <tr key={a.id} className={`${a.active ? "" : "opacity-50"} ${dirty ? "bg-amber-50/60" : ""}`}>
                  <td className="sticky start-0 z-10 border-t border-zinc-100 bg-(--surface) p-2">
                    <button
                      type="button"
                      onClick={() => setMany(companies.map((c) => [a, c.id] as [Agent, string]), !rowAll(a))}
                      className="text-start hover:text-brand-700"
                      title={t("علّم على الكل / شيل الكل")}
                    >
                      <span className="block font-medium">{a.name}{dirty ? " •" : ""}</span>
                      <span className="block text-[11px] text-zinc-500">{a.team ?? t("من غير تيم")}</span>
                    </button>
                  </td>
                  {companies.map((c) => {
                    const ok = allowed(a, c.id);
                    const outside = !inTeam(a, c.id);
                    const on = checked.has(key(a.id, c.id));
                    const was = initial.has(key(a.id, c.id));
                    return (
                      <td key={c.id} className="border-t border-zinc-100 p-1 text-center">
                        <label className={`inline-grid size-9 place-items-center rounded-lg ${outside ? "border border-dashed border-zinc-300" : ""} ${on !== was ? "ring-2 ring-amber-400" : ""} ${ok ? "cursor-pointer hover:bg-zinc-100" : "cursor-not-allowed opacity-40"}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!ok || pending}
                            onChange={() => toggle(a, c.id)}
                            className="size-4 accent-brand-600"
                            aria-label={`${a.name} — ${c.name}`}
                          />
                        </label>
                      </td>
                    );
                  })}
                  <td className="border-t border-zinc-100 p-2 text-center tabular-nums">{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
