"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Clock, GripVertical } from "lucide-react";
import { updateLead } from "@/app/actions/leads";
import { CompanyLogo } from "@/components/ui";
import { celebrate, playSound, vibrate } from "@/lib/fx";
import { useLocale, useT } from "@/lib/i18n/client";
import { cairoDateTime } from "@/lib/time";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

export type BoardLead = {
  id: string;
  full_name: string;
  phone: string;
  status: LeadStatus;
  company: { name: string; logo_path: string | null };
  agent: string | null;
  callback_at: string | null;
  interview_at: string | null;
  attempts: number;
};

const COLUMNS: { status: LeadStatus; accent: string }[] = [
  { status: "new", accent: "bg-sky-500" },
  { status: "no_answer", accent: "bg-zinc-400" },
  { status: "contacted", accent: "bg-indigo-500" },
  { status: "interview", accent: "bg-violet-500" },
  { status: "documents", accent: "bg-amber-500" },
  { status: "hired", accent: "bg-emerald-500" },
  { status: "rejected", accent: "bg-rose-500" },
];

/** Status columns; drag a card (desktop) or use its menu (phone) to move it. */
export function LeadsBoard({ leads: initial, basePath, showAgent }: { leads: BoardLead[]; basePath: string; showAgent: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [leads, setLeads] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LeadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  // Server data changes (realtime refresh) replace local state.
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setLeads(initial);
  }

  const move = (id: string, status: LeadStatus) => {
    const before = leads.find((l) => l.id === id);
    if (!before || before.status === status) return;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    if (status === "hired") {
      celebrate();
      playSound("hire");
      vibrate([120, 60, 240]);
    } else playSound("tap");
    const form = new FormData();
    form.set("id", id);
    form.set("status", status);
    setError(null);
    start(async () => {
      try {
        await updateLead(form);
      } catch {
        setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status: before.status } : l)));
        setError(t("مقدرتش أعدل الليد"));
      }
    });
  };

  return (
    <div>
      {error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {COLUMNS.map((col) => {
          const items = leads.filter((l) => l.status === col.status);
          return (
            <section
              key={col.status}
              aria-label={t(LEAD_STATUS_LABELS[col.status])}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.status);
              }}
              onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                setOver(null);
                setDragging(null);
                if (id) move(id, col.status);
              }}
              className={`flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border bg-zinc-50/80 transition sm:w-72 ${
                over === col.status ? "border-brand-500 bg-brand-50/60" : "border-zinc-200"
              }`}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span className={`size-2.5 rounded-full ${col.accent}`} />
                <h3 className="text-sm font-bold">{t(LEAD_STATUS_LABELS[col.status])}</h3>
                <span className="num ms-auto rounded-full bg-white px-2 py-0.5 text-xs text-zinc-500 ring-1 ring-zinc-200">{items.length}</span>
              </header>
              <ul className="flex max-h-[68vh] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-3">
                {items.map((l) => (
                  <li
                    key={l.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", l.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(l.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={`group lift cursor-grab rounded-xl border border-zinc-200 bg-white p-3 active:cursor-grabbing ${dragging === l.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <CompanyLogo name={l.company.name} src={l.company.logo_path} size={28} />
                      <div className="min-w-0 flex-1">
                        <Link href={`${basePath}/${l.id}`} className="block truncate text-sm font-semibold hover:text-brand-700" draggable={false}>
                          {l.full_name}
                        </Link>
                        <p className="truncate text-[11px] text-zinc-500">
                          <span dir="ltr" className="num">{l.phone}</span> · {l.company.name}
                        </p>
                      </div>
                      <GripVertical size={14} className="mt-1 hidden shrink-0 text-zinc-300 group-hover:text-zinc-400 md:block" />
                    </div>
                    {(l.callback_at || l.interview_at || (showAgent && l.agent) || l.attempts > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        {l.callback_at && (
                          <span className={`badge ${new Date(l.callback_at) <= new Date() ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
                            <Clock size={11} /> {cairoDateTime(l.callback_at, locale)}
                          </span>
                        )}
                        {l.interview_at && (
                          <span className="badge bg-violet-100 text-violet-800"><CalendarClock size={11} /> {cairoDateTime(l.interview_at, locale)}</span>
                        )}
                        {l.attempts > 0 && <span className="badge bg-zinc-100 text-zinc-500">{t("{0} محاولة", l.attempts)}</span>}
                        {showAgent && l.agent && <span className="badge bg-zinc-100 text-zinc-600">{l.agent}</span>}
                      </div>
                    )}
                    <select
                      aria-label={t("حالة الليد")}
                      value={l.status}
                      onChange={(e) => move(l.id, e.target.value as LeadStatus)}
                      className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs md:hidden"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.status} value={c.status}>{t(LEAD_STATUS_LABELS[c.status])}</option>
                      ))}
                    </select>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="grid h-20 place-items-center rounded-xl border border-dashed border-zinc-200 text-xs text-zinc-400">{t("اسحب ليد هنا")}</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
