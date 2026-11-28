"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Coffee, Loader2, TimerReset, X } from "lucide-react";
import { decideBreak, endBreak, requestBreak, type BreakActionState } from "@/app/actions/breaks";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
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
          <Coffee size={18} className="text-teal-600" /> {t("البريك")}
        </h2>
        <span className="flex gap-1" aria-label={t("فاضل {0} من {1}", left, BREAKS_PER_DAY)}>
          {Array.from({ length: BREAKS_PER_DAY }, (_, i) => (
            <span key={i} className={`h-2 w-6 rounded-full ${i < used ? "bg-teal-500" : "bg-zinc-200"}`} />
          ))}
        </span>
      </div>

      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-teal-800">{t("إنت في بريك دلوقتي — فاضل")}</p>
            <p className="text-3xl font-semibold text-teal-700">
              <Countdown endsAt={active.ends_at!} onDone={() => router.refresh()} />
            </p>
          </div>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(active.id))}>
            <TimerReset size={14} /> {t("رجعت من البريك")}
          </button>
        </div>
      ) : waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <Loader2 size={16} className="animate-spin" /> {t("مستني موافقة التيم ليدر...")}
          </p>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(waiting.id))}>
            {t("إلغاء الطلب")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">
            {left > 0 ? t("معاك {0} بريك النهارده — كل واحد نص ساعة", left) : t("خلّصت البريكين بتوع النهارده")}
          </p>
          <button className="btn-dark btn-sm" disabled={pending || left === 0} onClick={() => run(requestBreak)}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Coffee size={14} />} {t("اطلب بريك")}
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
  const t = useT();
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
            <Check size={14} /> {t("موافق")}
          </button>
          <button className="btn-danger btn-sm" disabled={pending} onClick={() => run(() => decideBreak(id, false))}>
            <X size={14} /> {t("رفض")}
          </button>
        </>
      ) : (
        <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => endBreak(id))}>
          {t("إنهاء البريك")}
        </button>
      )}
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}

/** The same break flow as BreakWidget, folded into one header pill for the agent home. */
export function BreakChip({ today }: { today: BreakRow[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const now = useNow(false);

  const active = today.find((b) => b.status === "active" && b.ends_at && new Date(b.ends_at).getTime() > now);
  const waiting = today.find((b) => b.status === "pending");
  const used = today.filter((b) => b.status === "pending" || b.status === "ended" || b.status === "active").length;
  const left = Math.max(0, BREAKS_PER_DAY - used);
  const run = (fn: () => Promise<BreakActionState>) =>
    start(async () => {
      const r = await fn();
      setErr(r?.error);
      router.refresh();
    });

  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition disabled:opacity-50";
  return (
    <span className="inline-flex flex-col items-end">
      {active ? (
        <button type="button" className={`${base} bg-teal-100 text-teal-800 hover:bg-teal-200`} disabled={pending} onClick={() => run(() => endBreak(active.id))} title={t("رجعت من البريك")}>
          <Coffee size={16} /> <Countdown endsAt={active.ends_at!} onDone={() => router.refresh()} /> · {t("رجعت")}
        </button>
      ) : waiting ? (
        <button type="button" className={`${base} bg-amber-50 text-amber-800 hover:bg-amber-100`} disabled={pending} onClick={() => run(() => endBreak(waiting.id))} title={t("إلغاء الطلب")}>
          <Loader2 size={16} className="animate-spin" /> {t("مستني موافقة البريك")} <X size={14} />
        </button>
      ) : (
        <button type="button" className={`${base} bg-zinc-100 text-zinc-700 hover:bg-zinc-200`} disabled={pending || left === 0} onClick={() => run(requestBreak)}
          title={left > 0 ? t("معاك {0} بريك النهارده — كل واحد نص ساعة", left) : t("خلّصت البريكين بتوع النهارده")}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Coffee size={16} />} {t("بريك")} <span className="num text-xs opacity-60">{left}/{BREAKS_PER_DAY}</span>
        </button>
      )}
      {err && <span className="mt-1 text-xs text-rose-600">{err}</span>}
    </span>
  );
}
