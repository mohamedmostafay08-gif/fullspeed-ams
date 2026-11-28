"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, UserRoundCog, X } from "lucide-react";
import { bulkAssignLeads } from "@/app/actions/leads";
import { useT } from "@/lib/i18n/client";

// Row checkboxes in LeadsTable point at this form by id (form="bulk-leads").
const BULK_FORM = "bulk-leads";
const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form=${BULK_FORM}]`)];

/** Header checkbox: ticks or clears every lead on this page. */
export function SelectAllLeads() {
  const t = useT();
  return (
    <input
      type="checkbox"
      aria-label={t("اختار الكل")}
      className="size-4 accent-brand-600"
      onChange={(e) => {
        for (const b of boxes()) b.checked = e.target.checked;
        document.dispatchEvent(new Event("bulk-change"));
      }}
    />
  );
}

/** Appears once a lead is ticked: move the ticked leads to one agent, or off everyone, in one go. */
export function BulkLeadsBar({ agents }: { agents: { id: string; name: string }[] }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [state, action, pending] = useActionState(bulkAssignLeads, undefined);

  useEffect(() => {
    const recount = () => setCount(boxes().filter((b) => b.checked).length);
    const onChange = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      if (!el || el.type !== "checkbox" || el.name !== "ids") return;
      recount();
    };
    document.addEventListener("change", onChange);
    document.addEventListener("bulk-change", recount);
    return () => {
      document.removeEventListener("change", onChange);
      document.removeEventListener("bulk-change", recount);
    };
  }, []);

  useEffect(() => {
    if (!state?.ok) return;
    for (const b of boxes()) b.checked = false;
    for (const b of document.querySelectorAll<HTMLInputElement>("input[aria-label][type=checkbox]:not([name])")) b.checked = false;
    document.dispatchEvent(new Event("bulk-change"));
  }, [state]);

  const clear = () => {
    for (const b of boxes()) b.checked = false;
    document.dispatchEvent(new Event("bulk-change"));
  };

  return (
    <form id={BULK_FORM} action={action}>
      {(count > 0 || state?.ok || state?.error) && (
        <div className="glass animate-rise fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl p-3 shadow-xl md:bottom-6">
          {count > 0 ? (
            <>
              <span className="font-semibold">{t("{0} ليد مختار", count)}</span>
              <label className="flex flex-1 items-center gap-2">
                <UserRoundCog size={18} className="shrink-0 text-zinc-500" />
                <select name="agent_id" required defaultValue="" className="input min-w-44 flex-1">
                  <option value="" disabled>{t("انقلهم لأجنت…")}</option>
                  <option value="none">{t("شيلهم من الأجنت (مش متوزعين)")}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <button className="btn-primary" disabled={pending}>{pending && <Loader2 size={16} className="animate-spin" />} {t("انقل")}</button>
              <button type="button" onClick={clear} className="btn-ghost btn-sm" aria-label={t("إلغاء الاختيار")}><X size={16} /></button>
            </>
          ) : (
            <p className={`text-sm ${state?.error ? "text-rose-600" : "text-emerald-700"}`}>{state?.error ?? state?.ok}</p>
          )}
          {count > 0 && state?.error && <p className="w-full text-sm text-rose-600">{state.error}</p>}
        </div>
      )}
    </form>
  );
}
