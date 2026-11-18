"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { BellOff, BellRing, Download, Loader2, Share, Smartphone, X } from "lucide-react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/actions/push";
import { useT } from "@/lib/i18n/client";
import { PasskeyRegisterButton } from "@/components/passkeys";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// ───────── shared client state ─────────
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Registers the service worker once and captures the install prompt for later. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if ("clearAppBadge" in navigator) (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge().catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

function useInstall() {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const standalone = useSyncExternalStore(subscribe, isStandalone, () => true);
  const ios = useSyncExternalStore(subscribe, isIos, () => false);
  return { canPrompt, standalone, ios };
}

/** Header button: native install prompt (Android/desktop Chrome) or Add-to-Home-Screen steps (iPhone). */
export function InstallButton({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { canPrompt, standalone, ios } = useInstall();
  const [help, setHelp] = useState(false);
  if (standalone || (!canPrompt && !ios)) return null;
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (deferred) {
            await deferred.prompt();
            await deferred.userChoice.catch(() => null);
            deferred = null;
            emit();
          } else setHelp(true);
        }}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-50 text-xs font-bold whitespace-nowrap text-brand-700 transition hover:bg-brand-100 active:scale-95 ${compact ? "w-9 justify-center md:w-auto md:px-3" : "px-3"}`}
        aria-label={t("ثبّت التطبيق")}
        title={t("ثبّت التطبيق")}
      >
        <Download size={15} /> <span className={compact ? "hidden md:inline" : ""}>{t("ثبّت التطبيق")}</span>
      </button>
      {help && <IosHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function IosHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] grid animate-fade-in place-items-end bg-ink/60 p-4 sm:place-items-center" onClick={onClose}>
      <div className="w-full max-w-sm animate-slide-in rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-600 text-white"><Smartphone size={22} /></span>
          <h2 className="flex-1 text-lg font-extrabold">{t("ثبّت التطبيق على الآيفون")}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100" aria-label={t("إغلاق")}><X size={18} /></button>
        </div>
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3"><span className="num grid size-7 place-items-center rounded-full bg-zinc-100 font-bold">1</span>{t("افتح السيستم من Safari")}</li>
          <li className="flex items-center gap-3"><span className="num grid size-7 place-items-center rounded-full bg-zinc-100 font-bold">2</span>{t("دوس على زرار المشاركة")} <Share size={16} className="text-sky-600" /></li>
          <li className="flex items-center gap-3"><span className="num grid size-7 place-items-center rounded-full bg-zinc-100 font-bold">3</span>{t("اختار «Add to Home Screen» / «إضافة إلى الشاشة الرئيسية»")}</li>
          <li className="flex items-center gap-3"><span className="num grid size-7 place-items-center rounded-full bg-zinc-100 font-bold">4</span>{t("افتح Full Speed من الأيقونة وفعّل الإشعارات")}</li>
        </ol>
      </div>
    </div>
  );
}

type PushState = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on";

function usePush(publicKey: string | null) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: PushState;
      if (!publicKey || !pushSupported()) next = isIos() && !isStandalone() ? "needs-install" : "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await navigator.serviceWorker.ready;
        next = (await reg.pushManager.getSubscription()) ? "on" : "off";
      }
      if (alive) setState(next);
    })().catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      setError(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey!) }));
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const res = await savePushSubscription(json, navigator.userAgent);
        if (res.error) throw new Error(res.error);
        setState("on");
      } catch {
        setError("مقدرتش أفعّل الإشعارات — جرّب تاني");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    });

  return { state, busy, error, enable, disable };
}

/** Settings card on the notifications page. */
export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const t = useT();
  const { state, busy, error, enable, disable } = usePush(publicKey);
  const [tested, setTested] = useState<string | null>(null);
  const [testing, startTest] = useTransition();

  return (
    <section className="card mb-5 flex flex-wrap items-center gap-4">
      <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${state === "on" ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}`}>
        {state === "on" ? <BellRing size={22} /> : <BellOff size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{t("إشعارات على الجهاز ده")}</p>
        <p className="text-sm text-zinc-500">
          {state === "on" && t("شغالة — هيوصلك كل جديد حتى لو السيستم مقفول")}
          {state === "off" && t("فعّلها عشان يوصلك الليدز والبونص والتذكيرات حتى لو السيستم مقفول")}
          {state === "denied" && t("الإشعارات مقفولة من المتصفح — افتحها من إعدادات الموقع (علامة القفل جنب العنوان)")}
          {state === "needs-install" && t("على الآيفون لازم تثبّت التطبيق الأول على الشاشة الرئيسية، وبعدين تفعّل الإشعارات من جواه")}
          {state === "unsupported" && t("المتصفح ده مش بيدعم الإشعارات — استخدم Chrome")}
          {state === "loading" && "…"}
        </p>
        {error && <p className="mt-1 text-sm text-rose-600">{t(error)}</p>}
        {tested && <p className="mt-1 text-sm text-emerald-600">{t(tested)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {state === "off" && (
          <button onClick={enable} disabled={busy} className="btn-primary">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} />} {t("فعّل الإشعارات")}
          </button>
        )}
        {state === "on" && (
          <>
            <button
              onClick={() =>
                startTest(async () => {
                  const r = await sendTestPush();
                  setTested(r.error ? "مقدرتش أبعت" : "اتبعت — اقفل السيستم أو صغّره وهتلاقيه وصل");
                })
              }
              disabled={testing}
              className="btn-ghost"
            >
              {testing && <Loader2 size={16} className="animate-spin" />} {t("ابعت إشعار تجربة")}
            </button>
            <button onClick={disable} disabled={busy} className="btn-ghost text-rose-600">{t("إيقاف")}</button>
          </>
        )}
        {state === "needs-install" && <InstallButton />}
      </div>
    </section>
  );
}

/** One-time nudge on dashboards until the device is set up (or dismissed). */
export function DeviceSetupBanner({ publicKey, hasPasskey = true }: { publicKey: string | null; hasPasskey?: boolean }) {
  const t = useT();
  const { state, busy, enable } = usePush(publicKey);
  const { canPrompt, standalone, ios } = useInstall();
  const dismissed = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem("fs-setup-dismissed") === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
  const passkeyCapable = useSyncExternalStore(subscribe, () => "PublicKeyCredential" in window && /android|iphone|ipad/i.test(navigator.userAgent), () => false);
  const wantsInstall = !standalone && (canPrompt || ios);
  const wantsPush = state === "off" || state === "needs-install";
  const wantsPasskey = !hasPasskey && passkeyCapable;
  if (dismissed || state === "loading" || (!wantsInstall && !wantsPush && !wantsPasskey)) return null;

  return (
    <div className="relative mb-5 grid animate-rise grid-cols-[auto_1fr] items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 pe-10 sm:flex sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Smartphone size={20} /></span>
      <div className="min-w-0 sm:flex-1">
        <p className="font-bold text-brand-700">{t("خلّي السيستم على موبايلك")}</p>
        <p className="text-[13px] leading-5 text-zinc-600">{t("ثبّته كتطبيق، فعّل الإشعارات والدخول بالبصمة — هيوصلك كل ليد وبونص فوراً وتدخل بلمسة")}</p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1">
        {wantsInstall && <InstallButton />}
        {state === "off" && (
          <button onClick={enable} disabled={busy} className="btn-primary btn-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} {t("فعّل الإشعارات")}
          </button>
        )}
        {wantsPasskey && <PasskeyRegisterButton className="btn-dark btn-sm" />}
        <button
          onClick={() => {
            try {
              localStorage.setItem("fs-setup-dismissed", "1");
            } catch {}
            emit();
          }}
          className="absolute end-2 top-2 rounded-lg p-1.5 text-zinc-400 hover:bg-white"
          aria-label={t("إغلاق")}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
