"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PhoneCall, PhoneOff, X } from "lucide-react";
import { logCall } from "@/app/actions/leads";
import { CallPanel } from "@/components/call-panel";
import { useT } from "@/lib/i18n/client";

type Pending = { leadId: string; name: string; startedAt: string };
const KEY = "fs-call";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const read = (): string | null => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

function setPending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {}
  emit();
}

/** Call button: opens the dialer and starts the timer for this lead. */
export function CallButton({ leadId, name, phone, className = "btn-primary", children }: { leadId: string; name: string; phone: string; className?: string; children?: React.ReactNode }) {
  return (
    <a href={`tel:${phone}`} className={className} onClick={() => setPending({ leadId, name, startedAt: new Date().toISOString() })}>
      {children ?? (
        <>
          <PhoneCall size={18} /> <span dir="ltr" className="num">{phone}</span>
        </>
      )}
    </a>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Watches for the agent coming back from a call: logs the duration and asks for the outcome.
 * While a call is "open" (e.g. on a desktop with no dialer) a small pill lets them end it by hand.
 */
export function CallReturnWatcher() {
  const t = useT();
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const pending: Pending | null = raw ? JSON.parse(raw) : null;
  const [ended, setEnded] = useState<(Pending & { seconds: number }) | null>(null);
  const [now, setNow] = useState(0);

  const finish = (p: Pending) => {
    const seconds = Math.max(0, (Date.now() - Date.parse(p.startedAt)) / 1000);
    setPending(null);
    setEnded({ ...p, seconds });
    void logCall(p.leadId, p.startedAt, seconds);
  };

  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const back = () => {
      // The dialer took over the screen; coming back = call finished.
      if (document.visibilityState === "visible" && Date.now() - Date.parse(pending.startedAt) > 4000) finish(pending);
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  });

  return (
    <>
      {pending && !ended && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+92px)] z-40 flex animate-slide-in items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3 text-white shadow-xl md:inset-x-auto md:end-6 md:bottom-6 md:w-80">
          <span className="relative grid size-9 place-items-center rounded-full bg-white/20">
            <PhoneCall size={17} />
            <span className="absolute inset-0 animate-ping rounded-full bg-white/30" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{pending.name}</p>
            <p className="num text-xs text-white/80">{fmt(Math.max(0, ((now || Date.parse(pending.startedAt)) - Date.parse(pending.startedAt)) / 1000))}</p>
          </div>
          <button onClick={() => finish(pending)} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-700 active:scale-95">
            <PhoneOff size={14} /> {t("خلصت")}
          </button>
        </div>
      )}

      {ended && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
          <button className="absolute inset-0 animate-fade-in bg-ink/50" aria-label={t("إغلاق")} onClick={() => setEnded(null)} />
          <div className="relative max-h-[90vh] w-full max-w-lg animate-sheet-up overflow-y-auto rounded-t-[28px] bg-canvas p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl sm:rounded-[28px]">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><PhoneOff size={20} /></span>
              <div className="flex-1">
                <p className="font-extrabold">{t("المكالمة خلصت — إيه النتيجة؟")}</p>
                <p className="text-sm text-zinc-500">{ended.name} · <span className="num">{fmt(ended.seconds)}</span></p>
              </div>
              <button onClick={() => setEnded(null)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100" aria-label={t("إغلاق")}><X size={18} /></button>
            </div>
            <CallPanel leadId={ended.leadId} onDone={() => setEnded(null)} />
          </div>
        </div>
      )}
    </>
  );
}
