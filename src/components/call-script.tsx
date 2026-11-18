"use client";

import { useState } from "react";
import { ChevronDown, ScrollText } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Renders a company's call script. Line syntax:
 *   "# title"  → section heading
 *   "? text"   → question to tick off during the call
 *   anything else → talking point
 */
export function CallScript({ script, defaultOpen = true }: { script: string | null; defaultOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [done, setDone] = useState<Set<number>>(new Set());
  if (!script?.trim()) return null;
  const lines = script.split("\n").map((l) => l.trim()).filter(Boolean);
  const questions = lines.filter((l) => /^[?؟]/.test(l)).length;

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-start" aria-expanded={open}>
        <ScrollText size={18} className="text-sky-700" />
        <span className="flex-1 font-bold text-sky-900">{t("سكربت المكالمة")}</span>
        {questions > 0 && <span className="num rounded-full bg-white px-2 py-0.5 text-xs text-sky-800">{done.size}/{questions}</span>}
        <ChevronDown size={18} className={`text-sky-700 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="space-y-1.5 px-4 pb-4 text-sm leading-6 text-sky-950">
          {lines.map((line, i) => {
            if (line.startsWith("#")) return <li key={i} className="pt-2 text-xs font-extrabold tracking-wide text-sky-700 uppercase">{line.replace(/^#+\s*/, "")}</li>;
            if (/^[?؟]/.test(line)) {
              const checked = done.has(i);
              return (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white/70 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setDone((s) => { const n = new Set(s); if (checked) n.delete(i); else n.add(i); return n; })}
                      className="mt-1 size-4 accent-sky-600"
                    />
                    <span className={checked ? "text-sky-900/50 line-through" : "font-semibold"}>{line.replace(/^[?؟]\s*/, "")}</span>
                  </label>
                </li>
              );
            }
            return <li key={i} className="flex gap-2"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sky-500" />{line.replace(/^[-•]\s*/, "")}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
