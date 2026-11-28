"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Loader2, Search, UserRound } from "lucide-react";
import { searchLeads, type LeadHit } from "@/app/actions/search";
import { useT } from "@/lib/i18n/client";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

type Page = { href: string; label: string; group?: string };
type Row = { key: string; href: string; title: string; sub?: string; kind: "page" | "lead" };

/** Ctrl+K (or the search button): jump to a page, or find a lead by phone or name. */
export function CommandPalette({ pages, leadBase }: { pages: Page[]; leadBase: string | null }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<LeadHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const id = setTimeout(() => input.current?.focus(), 10);
    return () => {
      document.body.style.overflow = "";
      clearTimeout(id);
    };
  }, [open]);

  // Lead search waits for a short pause in typing; only the latest answer is kept.
  useEffect(() => {
    if (!leadBase || q.trim().length < 2) return;
    const my = ++seq.current;
    const id = setTimeout(() => {
      start(async () => {
        const hits = await searchLeads(q);
        if (my === seq.current) setLeads(hits);
      });
    }, 250);
    return () => clearTimeout(id);
  }, [q, leadBase]);

  const rows = useMemo<Row[]>(() => {
    const term = q.trim().toLowerCase();
    const pageRows = pages
      .filter((p) => !term || t(p.label).toLowerCase().includes(term) || p.label.includes(term))
      .slice(0, term ? 6 : 8)
      .map((p) => ({ key: p.href, href: p.href, title: t(p.label), sub: p.group ? t(p.group) : undefined, kind: "page" as const }));
    const leadRows =
      leadBase && term.length >= 2
        ? leads.map((l) => ({
            key: l.id,
            href: `${leadBase}/${l.id}`,
            title: l.full_name,
            sub: [l.phone, l.company, t(LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status)].filter(Boolean).join(" · "),
            kind: "lead" as const,
          }))
        : [];
    return [...leadRows, ...pageRows];
  }, [q, leads, pages, leadBase, t]);

  const close = () => {
    setOpen(false);
    setQ("");
    setLeads([]);
    setSel(0);
  };
  const go = (r: Row | undefined) => {
    if (!r) return;
    close();
    router.push(r.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl p-2 text-zinc-500 transition hover:bg-(--glass-strong) hover:text-(--fg) md:border md:border-(--glass-line) md:bg-(--glass-strong) md:px-3 md:py-1.5"
        aria-label={t("بحث")}
        title={t("بحث")}
      >
        <Search size={18} />
        <span className="hidden text-sm md:inline">{t("دوّر على ليد أو صفحة")}</span>
        <kbd className="hidden rounded-md border border-(--glass-line) px-1.5 font-mono text-[10px] lg:inline">Ctrl K</kbd>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label={t("بحث")}>
          <button className="absolute inset-0 animate-fade-in bg-ink/50" aria-label={t("إغلاق")} onClick={close} />
          {/* Rendered on <body>: the header's blur would otherwise trap this fixed layer inside the header. */}
          <div className="relative w-full max-w-xl animate-fade-in overflow-hidden rounded-2xl border border-(--glass-line) bg-(--surface) shadow-2xl">
            <div className="flex items-center gap-3 border-b border-(--glass-line) px-4">
              {loading ? <Loader2 size={18} className="animate-spin text-zinc-400" /> : <Search size={18} className="text-zinc-400" />}
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                  if (e.target.value.trim().length < 2) setLeads([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); go(rows[sel]); }
                }}
                placeholder={leadBase ? t("رقم موبايل، اسم ليد، أو اسم صفحة") : t("اسم الصفحة")}
                className="h-14 w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
                inputMode="search"
                autoComplete="off"
              />
            </div>
            <ul className="max-h-[55vh] overflow-y-auto p-2">
              {rows.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-zinc-500">{loading ? t("بيدوّر…") : t("مفيش نتايج")}</li>
              )}
              {rows.map((r, i) => {
                const Icon = r.kind === "lead" ? UserRound : FileText;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start ${i === sel ? "bg-brand-50 text-brand-700" : ""}`}
                    >
                      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${r.kind === "lead" ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-500"}`}>
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.title}</span>
                        {r.sub && <span dir="auto" className="block truncate text-xs text-zinc-500">{r.sub}</span>}
                      </span>
                      {i === sel && <CornerDownLeft size={14} className="shrink-0 opacity-60" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
