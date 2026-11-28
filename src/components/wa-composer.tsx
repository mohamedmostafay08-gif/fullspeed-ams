"use client";

import { useActionState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import type { ActionState } from "@/app/admin/actions";
import { sendWaReply, sendWaTemplate } from "@/app/actions/wa";
import { useT } from "@/lib/i18n/client";

/** Reply box. Inside the 24-hour window: free text. Outside it: only the approved welcome template. */
export function WaComposer({ phone, open, configured, canTemplate = true }: { phone: string; open: boolean; configured: boolean; canTemplate?: boolean }) {
  const t = useT();
  const [state, send, pending] = useActionState<ActionState, FormData>(open ? sendWaReply : sendWaTemplate, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  if (!configured) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t("الرد من السيستم محتاج ربط واتساب من «النسخ والتكاملات»")}</p>;
  return (
    <form ref={ref} action={send} className="space-y-2">
      <input type="hidden" name="phone" value={phone} />
      {open ? (
        <div className="flex items-end gap-2">
          <textarea
            name="text"
            rows={2}
            required
            maxLength={4000}
            placeholder={t("اكتب ردك…")}
            className="input min-h-[44px] flex-1 resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
            }}
          />
          <button className="btn-primary h-11 px-3.5" disabled={pending} aria-label={t("ابعت")}><Send size={18} className="ltr:rotate-0 rtl:-scale-x-100" /></button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-(--glass-strong) p-3 text-sm">
          {canTemplate ? (
            <>
              <span className="flex-1 text-zinc-500">{t("عدّى 24 ساعة من آخر رسالة منه، فواتساب مش هيسمح برسالة عادية. ابعت قالب الترحيب، ولما يرد تقدر تكلمه.")}</span>
              <button className="btn-primary btn-sm" disabled={pending}>📨 {t("ابعت قالب الترحيب")}</button>
            </>
          ) : (
            <span className="flex-1 text-zinc-500">{t("عدّى 24 ساعة من آخر رسالة منه، فواتساب مش هيسمح برسالة عادية. كلّمه في التليفون، ولما يبعت رسالة تقدر ترد عليه من هنا.")}</span>
          )}
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm font-semibold text-rose-600">⚠️ {t(state.error)}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald-600">{t(state.ok)}</p>}
    </form>
  );
}
