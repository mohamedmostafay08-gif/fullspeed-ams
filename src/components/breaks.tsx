"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Coffee, Loader2, TimerReset, X } from "lucide-react";
import { decideBreak, endBreak, requestBreak, type BreakActionState } from "@/app/actions/breaks";

export const BREAKS_PER_DAY = 2;

export type BreakRow = {
  id: string;
  status: "pending" | "active" | "ended" | "rejected" | "cancelled";
  requested_at: string;
  started_at: string | null;
  ends_at: string | null;
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Countdown({ endsAt, onDone }: { endsAt: string; onDone?: () => void }) {
  const now = useNow(true);
  const left = Math.max(0, new Date(endsAt).getTime() - now);
  useEffect(() => {
    if (left === 0) onDone?.();
  }, [left, onDone]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="num" dir="ltr">
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

/** Agent-side card: request a break, wait for approval, count down the 30 minutes. */
export function BreakWidget({ today }: { today: BreakRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<BreakActionState>();
  const now = useNow(false);

  const active = today.find((b) => b.status === "active" && b.ends_at && new Date(b.ends_at).getTime() > now);
  const waiting = today.find((b) => b.status === "pending");
  const used = today.filter((b) => b.status === "pending" || b.status === "ended" || b.status === "active").length;
  const left = Math.max(0, BREAKS_PER_DAY - used);

  const run = (fn: () => Promise<BreakActionState>) =>
    start(async () => {
      setMsg(await fn());
      router.refresh();
    });

  return (
    <section className={`card ${active ? "border-teal-300 bg-teal-50/60" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <Coffee size={18} className="text-teal-600" /> البريك
        </h2>
        <span className="flex gap-1" aria-label={`فاضل ${left} من ${BREAKS_PER_DAY}`}>
          {Array.from({ length: BREAKS_PER_DAY }, (_, i) => (
            <span key={i} className={`h-2 w-6 rounded-full ${i < used ? "bg-teal-500" : "bg-zinc-200"}`} />
          ))}
        </span>
      </div>

      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-teal-800">إنت في بريك دلوقتي — فاضل</p>
            <p className="text-3xl font-semibold text-teal-700">
              <Countdown endsAt={active.ends_at!} onDone={() => router.refresh()} />
            </p>
          </div>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(active.id))}>
            <TimerReset size={14} /> رجعت من البريك
          </button>
        </div>
      ) : waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <Loader2 size={16} className="animate-spin" /> مستني موافقة التيم ليدر...
          </p>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(waiting.id))}>
            إلغاء الطلب
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">
            {left > 0 ? `معاك ${left} بريك النهارده — كل واحد نص ساعة` : "خلّصت البريكين بتوع النهارده"}
          </p>
          <button className="btn-dark btn-sm" disabled={pending || left === 0} onClick={() => run(requestBreak)}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Coffee size={14} />} اطلب بريك
          </button>
        </div>
      )}
      {msg?.error && <p className="mt-2 text-sm text-rose-600">{msg.error}</p>}
      {msg?.ok && !msg.error && waiting && <p className="mt-2 text-sm text-emerald-600">{msg.ok}</p>}
    </section>
  );
}

/** Staff-side approve / reject / end buttons. */
export function BreakDecision({ id, mode }: { id: string; mode: "pending" | "active" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const run = (fn: () => Promise<BreakActionState>) =>
    start(async () => {
      const r = await fn();
      setErr(r?.error);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-1.5">
      {mode === "pending" ? (
        <>
          <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(() => decideBreak(id, true))}>
            <Check size={14} /> موافق
          </button>
          <button className="btn-danger btn-sm" disabled={pending} onClick={() => run(() => decideBreak(id, false))}>
            <X size={14} /> رفض
          </button>
        </>
      ) : (
        <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(id))}>
          إنهاء البريك
        </button>
      )}
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}
