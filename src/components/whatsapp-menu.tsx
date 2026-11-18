"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { logWhatsApp } from "@/app/actions/leads";
import { useT } from "@/lib/i18n/client";
import { fillTemplate, waLink, type Template, type TemplateVars } from "@/lib/whatsapp";

/** WhatsApp button with ready-made messages; picking one opens the chat with the text filled in. */
export function WhatsAppMenu({
  leadId,
  phone,
  templates,
  vars,
  size = "md",
}: {
  leadId: string;
  phone: string;
  templates: Template[];
  vars: TemplateVars;
  size?: "sm" | "md";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const send = (tpl: Template | null) => {
    setOpen(false);
    window.open(waLink(phone, tpl ? fillTemplate(tpl.body, vars) : undefined), "_blank", "noopener");
    void logWhatsApp(leadId, tpl?.title ?? t("رسالة فاضية"));
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-200 ${size === "sm" ? "btn-sm" : ""}`}
      >
        <MessageCircle size={size === "sm" ? 14 : 17} /> {t("واتساب")} <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-40 mt-2 w-72 animate-pop overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              role="menuitem"
              type="button"
              onClick={() => send(tpl)}
              className="block w-full rounded-xl px-3 py-2 text-start transition hover:bg-emerald-50"
            >
              <span className="block text-sm font-semibold">{tpl.title}</span>
              <span className="line-clamp-2 text-xs text-zinc-500">{fillTemplate(tpl.body, vars)}</span>
            </button>
          ))}
          <button role="menuitem" type="button" onClick={() => send(null)} className="block w-full rounded-xl px-3 py-2 text-start text-sm text-zinc-600 hover:bg-zinc-50">
            {t("فتح الشات من غير رسالة")}
          </button>
        </div>
      )}
    </div>
  );
}
