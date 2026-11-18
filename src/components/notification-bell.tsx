"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Gift, Sparkles, X } from "lucide-react";
import { subscribeAsUser } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { celebrate, playSound, vibrate, type Sound } from "@/lib/fx";
import type { NotificationType } from "@/lib/types";

type Incoming = { type: NotificationType; title: string; body: string | null; link: string | null };

const SOUND: Partial<Record<NotificationType, Sound>> = { lead: "lead", assignment: "lead", bonus: "bonus", rate: "bonus" };

// The unread count comes from the server; realtime events add the effects and trigger a refresh.
export function NotificationBell({ userId, initial: count, href }: { userId: string; initial: number; href: string }) {
  const t = useT();
  const [toast, setToast] = useState<Incoming | null>(null);
  const [takeover, setTakeover] = useState<Incoming | null>(null);
  const [ring, setRing] = useState(0);
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(
    () =>
      subscribeAsUser(`notifications:${userId}`, (channel) =>
        channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            const n = payload.new as Incoming;
            const big = n.type === "bonus" || n.type === "rate";
            playSound(SOUND[n.type] ?? "notify");
            vibrate(big ? [220, 90, 220, 90, 400] : n.type === "lead" ? [120, 60, 120] : 90);
            setRing((r) => r + 1);
            if (big) {
              setTakeover(n);
              celebrate();
            } else setToast(n);
            routerRef.current.refresh();
          },
        ),
      ),
    [userId],
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!takeover) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTakeover(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [takeover]);

  return (
    <>
      <Link href={href} className="relative rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-ink" aria-label={t("الإشعارات")}>
        <Bell key={ring} size={20} className={ring ? "animate-wiggle" : undefined} />
        {count > 0 && (
          <span
            key={`c${count}`}
            className="num absolute -end-0.5 -top-0.5 min-w-5 animate-pop rounded-full bg-brand-600 px-1 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>

      {toast &&
        createPortal(
          <div
            role="status"
            className="fixed end-4 bottom-20 z-50 flex max-w-sm animate-slide-in items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-2xl shadow-ink/30 md:end-6 md:bottom-6"
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-600">
              <Bell size={14} />
            </span>
            <Link href={toast.link ?? href} onClick={() => setToast(null)} className="flex-1 leading-6">
              <span className="block font-semibold">{t(toast.title)}</span>
              {toast.body && <span className="block text-xs text-slate-ink">{t(toast.body)}</span>}
            </Link>
            <button onClick={() => setToast(null)} className="text-slate-ink hover:text-white" aria-label={t("إغلاق")}>
              <X size={16} />
            </button>
          </div>,
          // Portalled: the sticky header's backdrop-filter would otherwise anchor this "fixed" toast to the header.
          document.body,
        )}

      {takeover &&
        createPortal(
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="takeover-title"
            className="fixed inset-0 z-[60] grid animate-fade-in place-items-center bg-ink/80 p-4 backdrop-blur-sm"
            onClick={() => setTakeover(null)}
          >
            <div
              className="relative w-full max-w-md animate-zoom-in overflow-hidden rounded-3xl bg-gradient-to-b from-brand-500 to-brand-700 p-8 text-center text-white shadow-2xl shadow-brand-600/40"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(255,255,255,0.25),transparent_30%)]" />
              <span className="relative mx-auto grid size-20 animate-bounce-in place-items-center rounded-full bg-white text-brand-600 shadow-lg">
                <Gift size={38} />
              </span>
              <p className="relative mt-5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold tracking-wide uppercase">
                <Sparkles size={14} /> {takeover.type === "bonus" ? t("بونص جديد!") : t("تعريفة جديدة")}
              </p>
              <h2 id="takeover-title" className="relative mt-3 text-2xl leading-snug font-extrabold">{t(takeover.title)}</h2>
              {takeover.body && <p className="relative mt-2 text-lg font-semibold text-white/90">{t(takeover.body)}</p>}
              <div className="relative mt-7 flex justify-center gap-2">
                <Link href={takeover.link ?? href} onClick={() => setTakeover(null)} className="btn bg-white text-brand-700 hover:bg-brand-50">
                  {t("عرض التفاصيل")}
                </Link>
                <button onClick={() => setTakeover(null)} className="btn bg-white/15 text-white hover:bg-white/25">
                  {t("تمام")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
