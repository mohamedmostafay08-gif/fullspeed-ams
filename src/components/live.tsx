"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLead } from "@/app/actions/leads";
import { subscribeAsUser } from "@/lib/supabase/client";
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { useT } from "@/lib/i18n/client";
import { celebrate, playSound, vibrate } from "@/lib/fx";

/** Re-renders the current page when leads, tasks or breaks change (RLS limits what each user hears about). */
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
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_breaks" }, refresh),
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
    };
  }, [channel, router]);

  return null;
}

export function LeadStatusSelect({ id, status }: { id: string; status: LeadStatus }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={t("حالة الليد")}
      defaultValue={status}
      disabled={pending}
      onChange={(e) => {
        const form = new FormData();
        form.set("id", id);
        form.set("status", e.target.value);
        if (e.target.value === "hired") {
          celebrate();
          playSound("hire");
          vibrate([120, 60, 240]);
        } else playSound("tap");
        start(() => updateLead(form));
      }}
      className={`cursor-pointer rounded-full border-0 py-1 ps-3 pe-7 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 ${LEAD_STATUS_COLORS[status]}`}
    >
      {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => (
        <option key={s} value={s}>{t(LEAD_STATUS_LABELS[s])}</option>
      ))}
    </select>
  );
}
