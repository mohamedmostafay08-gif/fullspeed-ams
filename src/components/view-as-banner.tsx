"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, LogOut, Lock } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Shown on every agent page while the admin is in «شوف كأجنت». Says whose eyes they are looking
 * through, lets them hop to another agent, and takes them back to the admin. It also stops any
 * form that would save something before it leaves the browser (the proxy refuses it anyway).
 */
export function ViewAsBanner({ agentId, agentName, agents }: { agentId: string; agentName: string; agents: { id: string; full_name: string }[] }) {
  const t = useT();
  const [blocked, setBlocked] = useState(false);
  const switchRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      const action = form.getAttribute("action") ?? "";
      const writes = action.startsWith("javascript:") || (form.method.toLowerCase() === "post" && !action.startsWith("/api/view-as"));
      if (!writes) return; // search and filter forms (GET) keep working
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlocked(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBlocked(false), 3500);
    };
    window.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("submit", onSubmit, true);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div className="border-b border-violet-300/60 bg-violet-600 text-white shadow-[0_8px_24px_-12px_rgba(91,33,182,0.7)]">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-sm md:px-8">
          <p className="flex items-center gap-2 font-semibold">
            <Eye size={17} className="shrink-0" />
            <span>
              👀 {t("إنت شايف السيستم بعين")} <b className="font-extrabold">{agentName}</b>
            </span>
            <span className="hidden items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs sm:inline-flex">
              <Lock size={12} /> {t("عرض بس")}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <form ref={switchRef} action="/api/view-as" method="post">
              <select
                name="agent"
                defaultValue={agentId}
                aria-label={t("بدّل الأجنت")}
                onChange={() => switchRef.current?.requestSubmit()}
                className="max-w-44 rounded-xl border border-white/30 bg-white/15 px-2.5 py-1.5 text-sm font-semibold text-white outline-none [&>option]:text-ink"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.full_name}</option>
                ))}
              </select>
            </form>
            <form action="/api/view-as/exit" method="post">
              <button className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-violet-700 transition active:scale-95">
                <LogOut size={15} /> {t("رجوع للإدارة")}
              </button>
            </form>
          </div>
        </div>
      </div>
      {blocked && (
        <div role="status" className="fixed inset-x-4 bottom-28 z-50 mx-auto max-w-md animate-fade-in rounded-2xl bg-ink px-4 py-3 text-center text-sm font-semibold text-white shadow-2xl md:bottom-8">
          🔒 {t("وضع العرض بس: مينفعش تحفظ أو تعدّل حاجة وإنت شايف السيستم كأجنت")}
        </div>
      )}
    </>
  );
}
