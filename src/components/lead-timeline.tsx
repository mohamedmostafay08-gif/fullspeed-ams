"use client";

import { useState } from "react";
import { CalendarClock, FileText, MessageCircle, PhoneCall, Repeat, StickyNote, UserPlus } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export type TimelineKind = "call" | "wa" | "schedule" | "doc" | "status" | "created" | "note";
export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  at: string; // ISO, for sorting
  when: string; // already formatted in Cairo time
  title: string;
  sub?: string;
  bubbles?: { mine: boolean; text: string }[];
};

const ICON: Record<TimelineKind, { icon: typeof PhoneCall; cls: string }> = {
  call: { icon: PhoneCall, cls: "bg-sky-50 text-sky-700" },
  wa: { icon: MessageCircle, cls: "bg-emerald-50 text-emerald-700" },
  schedule: { icon: CalendarClock, cls: "bg-violet-50 text-violet-700" },
  doc: { icon: FileText, cls: "bg-zinc-100 text-zinc-600" },
  status: { icon: Repeat, cls: "bg-zinc-100 text-zinc-600" },
  created: { icon: UserPlus, cls: "bg-brand-50 text-brand-700" },
  note: { icon: StickyNote, cls: "bg-amber-50 text-amber-700" },
};

const FILTERS: { key: "all" | TimelineKind; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "call", label: "مكالمات" },
  { key: "wa", label: "واتساب" },
  { key: "schedule", label: "مواعيد" },
  { key: "doc", label: "أوراق" },
];

/** Everything that happened with a lead on one line, newest first: calls, WhatsApp, dates, papers, status changes. */
export function LeadTimeline({ items }: { items: TimelineItem[] }) {
  const t = useT();
  const [filter, setFilter] = useState<"all" | TimelineKind>("all");
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  return (
    <section className="card" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="card-title">{t("كل اللي حصل")}</h2>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t("فلتر")}>
        {FILTERS.map((f) => {
          const n = f.key === "all" ? items.length : items.filter((i) => i.kind === f.key).length;
          if (f.key !== "all" && n === 0) return null;
          return (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`chip ${filter === f.key ? "border-(--fg) bg-(--fg) text-(--surface)" : ""}`}>
              {t(f.label)} <span className="num opacity-60">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{t("مفيش حاجة هنا لسه")}</p>
      ) : (
        <ol className="relative">
          {shown.map((i, idx) => {
            const { icon: Icon, cls } = ICON[i.kind];
            return (
              <li key={i.id} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-4">
                {idx < shown.length - 1 && <span aria-hidden className="absolute start-[13px] top-8 bottom-0 w-0.5 bg-(--glass-line)" />}
                <span className={`grid size-7 place-items-center rounded-full ${cls}`}><Icon size={14} /></span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-semibold">{i.title}</p>
                  <p className="text-xs text-zinc-500">{[i.when, i.sub].filter(Boolean).join(" · ")}</p>
                  {i.bubbles?.map((b, k) => (
                    <p key={k} dir="auto" className={`mt-1.5 w-fit max-w-[min(100%,26rem)] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-line ${b.mine ? "bg-emerald-50 text-emerald-900" : "bg-zinc-100"}`}>
                      {b.text}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
