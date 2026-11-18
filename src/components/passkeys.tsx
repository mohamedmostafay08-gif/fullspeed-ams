"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, ScanFace } from "lucide-react";
import { finishPasskeyLogin, finishPasskeyRegistration, startPasskeyLogin, startPasskeyRegistration } from "@/app/actions/passkeys";
import { playSound, vibrate } from "@/lib/fx";
import { useT } from "@/lib/i18n/client";

const noop = () => () => {};
const isApple = () => /iphone|ipad|macintosh/i.test(navigator.userAgent);
/** "Face ID" on Apple devices, "fingerprint" elsewhere — matches what the phone will ask for. */
export function useBiometricLabel() {
  const apple = useSyncExternalStore(noop, isApple, () => false);
  return apple ? { label: "Face ID / بصمة", Icon: ScanFace } : { label: "البصمة", Icon: Fingerprint };
}
const supported = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

const cancelled = (e: unknown) => e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");

export function PasskeyLoginButton() {
  const t = useT();
  const ok = useSyncExternalStore(noop, supported, () => false);
  const { label, Icon } = useBiometricLabel();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!ok) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const begin = await startPasskeyLogin();
            if (!begin.ok) return setError(begin.error);
            try {
              const response = await startAuthentication({ optionsJSON: begin.options });
              const res = await finishPasskeyLogin(response);
              if (!res.ok) return setError(res.error);
              vibrate(60);
              window.location.assign(res.to);
            } catch (e) {
              if (!cancelled(e)) setError("مقدرتش أتأكد من البصمة");
            }
          })
        }
        className="btn-ghost w-full py-3"
      >
        {pending ? <Loader2 size={18} className="animate-spin" /> : <Icon size={20} className="text-brand-600" />} {t("ادخل بـ {0}", t(label))}
      </button>
      {error && <p role="alert" className="text-center text-sm text-rose-600">{t(error)}</p>}
    </div>
  );
}

export function PasskeyRegisterButton({ className = "btn-primary", onDone }: { className?: string; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const ok = useSyncExternalStore(noop, supported, () => false);
  const { label, Icon } = useBiometricLabel();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!ok) return null;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const begin = await startPasskeyRegistration();
            if (!begin.ok) return setMsg({ ok: false, text: begin.error });
            try {
              const response = await startRegistration({ optionsJSON: begin.options });
              const res = await finishPasskeyRegistration(response);
              if (!res.ok) return setMsg({ ok: false, text: res.error });
              playSound("notify");
              vibrate(60);
              try {
                localStorage.setItem("fs-passkey", "1");
              } catch {}
              setMsg({ ok: true, text: "تم ✓ — المرة الجاية ادخل بالبصمة من صفحة الدخول" });
              onDone?.();
              router.refresh();
            } catch (e) {
              setMsg(cancelled(e) ? null : { ok: false, text: e instanceof Error && e.name === "InvalidStateError" ? "الجهاز ده متسجل بالفعل" : "مقدرتش أتأكد من البصمة" });
            }
          })
        }
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Icon size={17} />} {t("فعّل الدخول بـ {0}", t(label))}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{t(msg.text)}</p>}
    </div>
  );
}
