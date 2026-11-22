"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock, Loader2, PartyPopper, PhoneOff, ThumbsDown } from "lucide-react";
import { recordCall, type CallOutcome } from "@/app/actions/leads";
import { celebrate, playSound, vibrate } from "@/lib/fx";
import { useT } from "@/lib/i18n/client";
import { toCairoLocal } from "@/lib/time";
import { REJECT_REASONS, type RejectReason } from "@/lib/types";

const OUTCOMES: { key: CallOutcome; label: string; icon: typeof CheckCircle2; cls: string }[] = [
  { key: "answered", label: "رد واتكلمنا", icon: CheckCircle2, cls: "bg-sky-50 text-sky-800 hover:bg-sky-100 ring-sky-200" },
  { key: "no_answer", label: "مردش", icon: PhoneOff, cls: "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 ring-zinc-300" },
  { key: "callback", label: "كلمه بعدين", icon: Clock, cls: "bg-amber-50 text-amber-800 hover:bg-amber-100 ring-amber-200" },
  { key: "interview", label: "حدد مقابلة", icon: CalendarClock, cls: "bg-violet-50 text-violet-800 hover:bg-violet-100 ring-violet-200" },
  { key: "hired", label: "اشتغل", icon: PartyPopper, cls: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 ring-emerald-200" },
  { key: "rejected", label: "رفض", icon: ThumbsDown, cls: "bg-rose-50 text-rose-700 hover:bg-rose-100 ring-rose-200" },
];

function preset(kind: "1h" | "3h" | "tomorrow") {
  if (kind === "tomorrow") return `${toCairoLocal(new Date(Date.now() + 86_400_000)).slice(0, 10)}T11:00`;
  return toCairoLocal(new Date(Date.now() + (kind === "1h" ? 1 : 3) * 3_600_000));
}

/** Logs a call result in one tap; call-back and interview ask for a time first. */
export function CallPanel({ leadId, onDone }: { leadId: string; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState<"callback" | "interview" | "rejected" | null>(null);
  const [reason, setReason] = useState<RejectReason | "">("");
  const [at, setAt] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (outcome: CallOutcome) => {
    if ((outcome === "callback" || outcome === "interview" || outcome === "rejected") && picking !== outcome) {
      setPicking(outcome);
      if (outcome !== "rejected") setAt(outcome === "callback" ? preset("1h") : preset("tomorrow"));
      setReason("");
      setError(null);
      return;
    }
    const form = new FormData();
    form.set("id", leadId);
    form.set("outcome", outcome);
    form.set("at", at);
    form.set("place", place);
    form.set("note", note);
    form.set("reason", reason);
    setError(null);
    start(async () => {
      const res = await recordCall(form);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (outcome === "hired") {
        celebrate();
        playSound("hire");
        vibrate([120, 60, 240]);
      } else playSound("tap");
      setPicking(null);
      setReason("");
      setNote("");
      setPlace("");
      onDone?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OUTCOMES.map(({ key, label, icon: Icon, cls }) => (
          <button
            key={key}
            type="button"
            disabled={pending}
            onClick={() => submit(key)}
            aria-pressed={picking === key}
            className={`btn justify-start py-3 ${cls} ${picking === key ? "ring-2" : ""}`}
          >
            <Icon size={18} /> {t(label)}
          </button>
        ))}
      </div>

      {picking === "rejected" && (
        <div className="animate-rise space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-bold text-rose-800">{t("سبب الرفض إيه؟")}</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(REJECT_REASONS) as RejectReason[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                aria-pressed={reason === r}
                className={`chip ${reason === r ? "border-rose-600 bg-rose-600 text-white" : ""}`}
              >
                {t(REJECT_REASONS[r])}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending || !reason} onClick={() => submit("rejected")} className="btn-primary">
              {pending && <Loader2 size={16} className="animate-spin" />} {t("تأكيد الرفض")}
            </button>
            <button type="button" onClick={() => setPicking(null)} className="btn-ghost">{t("إلغاء")}</button>
          </div>
        </div>
      )}

      {(picking === "callback" || picking === "interview") && (
        <div className="animate-rise space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {picking === "callback" ? (
              <>
                <button type="button" className="chip" onClick={() => setAt(preset("1h"))}>{t("بعد ساعة")}</button>
                <button type="button" className="chip" onClick={() => setAt(preset("3h"))}>{t("بعد 3 ساعات")}</button>
                <button type="button" className="chip" onClick={() => setAt(preset("tomorrow"))}>{t("بكرة 11 الصبح")}</button>
              </>
            ) : (
              <button type="button" className="chip" onClick={() => setAt(preset("tomorrow"))}>{t("بكرة 11 الصبح")}</button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="label">{picking === "callback" ? t("معاد المكالمة") : t("معاد المقابلة")}</span>
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="input" required />
            </label>
            {picking === "interview" && (
              <label className="block">
                <span className="label">{t("مكان المقابلة")}</span>
                <input value={place} onChange={(e) => setPlace(e.target.value)} className="input" placeholder={t("مثلاً: فرع مصر الجديدة")} />
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending || !at} onClick={() => submit(picking!)} className="btn-primary">
              {pending && <Loader2 size={16} className="animate-spin" />} {t("تأكيد")}
            </button>
            <button type="button" onClick={() => setPicking(null)} className="btn-ghost">{t("إلغاء")}</button>
          </div>
        </div>
      )}

      <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder={t("ملاحظة على المكالمة (اختياري)")} maxLength={300} />
      {error && <p className="text-sm text-rose-600">{t(error)}</p>}
      {pending && !picking && (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> {t("جاري الحفظ...")}</p>
      )}
    </div>
  );
}
