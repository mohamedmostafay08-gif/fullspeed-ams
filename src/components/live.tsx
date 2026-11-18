"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLead } from "@/app/actions/leads";
import { subscribeAsUser } from "@/lib/supabase/client";
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

/** Re-renders the current page when leads, tasks or targets change (RLS limits what each user hears about). */
export function LiveRefresh({ channel }: { channel: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 800);
    };
    const unsubscribe = subscribeAsUser(`live:${channel}`, (ch) =>
      ch
        .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh),
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
    };
  }, [channel, router]);

  return null;
}

export function LeadStatusSelect({ id, status }: { id: string; status: LeadStatus }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="حالة الليد"
      defaultValue={status}
      disabled={pending}
      onChange={(e) => {
        const form = new FormData();
        form.set("id", id);
        form.set("status", e.target.value);
        start(() => updateLead(form));
      }}
      className={`cursor-pointer rounded-full border-0 py-1 pr-3 pl-7 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 ${LEAD_STATUS_COLORS[status]}`}
    >
      {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => (
        <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
      ))}
    </select>
  );
}
