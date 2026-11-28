"use client";

import { useActionState, useState } from "react";
import { markInterview } from "@/app/actions/acquisition";
import { useT } from "@/lib/i18n/client";
import { toCairoLocal } from "@/lib/time";

/** Three buttons for an interview: came, didn't come, moved (asks for the new time). */
export function InterviewResult({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(markInterview, undefined);
  const [moving, setMoving] = useState<string | null>(null); // the suggested new time while picking
  const btn = `rounded-lg px-2.5 py-1 text-xs font-bold ring-1 transition disabled:opacity-50 ${compact ? "" : "sm:text-sm"}`;

  return (
    <div className="space-y-1.5">
      <form action={action} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="id" value={leadId} />
        {!moving ? (
          <>
            <button name="result" value="attended" disabled={pending} className={`${btn} bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100`}>✅ {t("حضر")}</button>
            <button name="result" value="no_show" disabled={pending} className={`${btn} bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100`}>🚫 {t("مجاش")}</button>
            <button type="button" onClick={() => setMoving(`${toCairoLocal(new Date(Date.now() + 86_400_000)).slice(0, 10)}T11:00`)} disabled={pending} className={`${btn} bg-violet-50 text-violet-800 ring-violet-200 hover:bg-violet-100`}>📅 {t("اتأجلت")}</button>
          </>
        ) : (
          <>
            <input type="datetime-local" name="at" required defaultValue={moving} className="input w-auto py-1 text-sm" aria-label={t("المعاد الجديد")} />
            <button name="result" value="rescheduled" disabled={pending} className={`${btn} bg-violet-600 text-white ring-violet-600`}>{t("احفظ المعاد")}</button>
            <button type="button" onClick={() => setMoving(null)} className="text-xs text-zinc-500 hover:underline">{t("إلغاء")}</button>
          </>
        )}
      </form>
      {state?.error && <p role="alert" className="text-xs text-rose-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-emerald-600">{state.ok}</p>}
    </div>
  );
}
