"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, MessageCircle } from "lucide-react";
import { logWhatsApp } from "@/app/actions/leads";
import type { ActionState } from "@/app/admin/actions";
import { sendWaQuick, waMode } from "@/app/actions/wa";
import { useT } from "@/lib/i18n/client";
import { fillTemplate, waLink, type Template, type TemplateVars } from "@/lib/whatsapp";

/** WhatsApp button with ready-made messages; picking one opens the chat with the text filled in. */
export function WhatsAppMenu({
  leadId,
  phone,
  templates,
  vars,
  size = "md",
  up = false,
}: {
  leadId: string;
  phone: string;
  templates: Template[];
  vars: TemplateVars;
  size?: "sm" | "md";
  /** Open the menu above the button (for bars pinned to the bottom of the screen). */
  up?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"inapp" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Through LineCRM's number the message goes out from the company and is saved on the lead,
  // so the button never opens the agent's own WhatsApp.
  useEffect(() => {
    let live = true;
    waMode().then((m) => live && setMode(m)).catch(() => live && setMode("link"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const send = async (tpl: Template | null) => {
    setOpen(false);
    if (mode === "inapp") {
      if (!tpl) {
        // The conversation lives on the lead page.
        router.push(`${pathname.startsWith("/admin") ? "/admin" : "/agent"}/inbox?p=${phone}`);
        return;
      }
      setBusy(true);
      setNote(null);
      const r: ActionState = await sendWaQuick(phone, fillTemplate(tpl.body, vars)).catch(() => ({ error: t("حصلت مشكلة، جرّب تاني") }));
      setBusy(false);
      setNote(r?.error ? { ok: false, text: r.error } : { ok: true, text: r?.ok ?? t("اتبعتت ✓") });
      return;
    }
    window.open(waLink(phone, tpl ? fillTemplate(tpl.body, vars) : undefined), "_blank", "noopener");
    void logWhatsApp(leadId, tpl?.title ?? t("رسالة فاضية"));
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy || mode === null}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-200 ${size === "sm" ? "btn-sm" : ""}`}
      >
        <MessageCircle size={size === "sm" ? 14 : 17} /> {t("واتساب")} <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className={`absolute end-0 z-40 w-72 animate-pop overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl ${up ? "bottom-full mb-2" : "mt-2"}`}>
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              role="menuitem"
              type="button"
              onClick={() => void send(tpl)}
              className="block w-full rounded-xl px-3 py-2 text-start transition hover:bg-emerald-50"
            >
              <span className="block text-sm font-semibold">{tpl.title}</span>
              <span className="line-clamp-2 text-xs text-zinc-500">{fillTemplate(tpl.body, vars)}</span>
            </button>
          ))}
          <button role="menuitem" type="button" onClick={() => void send(null)} className="block w-full rounded-xl px-3 py-2 text-start text-sm text-zinc-600 hover:bg-zinc-50">
            {mode === "inapp" ? t("افتح المحادثة") : t("فتح الشات من غير رسالة")}
          </button>
        </div>
      )}
      {note && (
        <p role={note.ok ? "status" : "alert"} className={`absolute end-0 z-40 mt-1 w-72 rounded-xl px-3 py-2 text-xs font-semibold shadow ${up ? "bottom-full mb-2" : ""} ${note.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} onClick={() => setNote(null)}>
          {note.ok ? note.text : `⚠️ ${note.text}`}
        </p>
      )}
    </div>
  );
}
