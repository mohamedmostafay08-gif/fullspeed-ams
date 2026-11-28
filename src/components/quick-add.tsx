"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Building2, CalendarOff, ClipboardList, Gift, Megaphone, Plus, UserPlus } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { Role } from "@/lib/types";

type Item = { href: string; label: string; icon: typeof Plus; roles: Role[] };

// One "+ إضافة" in the header for everything a person creates; each link lands on that page's form (#new).
const ITEMS: Item[] = [
  { href: "/agent/leads/new", label: "ليد جديد", icon: UserPlus, roles: ["agent"] },
  { href: "/agent/leaves", label: "إجازة أو إذن", icon: CalendarOff, roles: ["agent"] },
  { href: "/admin/leads/new", label: "ليد جديد", icon: UserPlus, roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/tasks#new", label: "تاسك", icon: ClipboardList, roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/memos#new", label: "تعميم", icon: Megaphone, roles: ["admin", "manager", "team_leader"] },
  { href: "/admin/announcements#new", label: "بونص أو تعريفة", icon: Gift, roles: ["admin", "manager"] },
  { href: "/admin/blacklist#new", label: "حظر رقم", icon: Ban, roles: ["admin", "manager"] },
  { href: "/admin/companies#new", label: "شركة", icon: Building2, roles: ["admin"] },
];

export function QuickAdd({ role }: { role: Role }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const items = ITEMS.filter((i) => i.roles.includes(role));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95"
      >
        <Plus size={16} /> <span className="hidden sm:inline">{t("إضافة")}</span>
      </button>
      {open && (
        <div role="menu" className="animate-rise absolute end-0 top-full z-40 mt-2 w-56 rounded-2xl border border-(--card-edge) bg-(--card) p-1.5 shadow-xl backdrop-blur-xl">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium hover:bg-zinc-100">
              <Icon size={16} className="text-zinc-500" /> {t(label)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
