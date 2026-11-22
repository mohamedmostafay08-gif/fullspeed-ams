"use client";

import { useRef } from "react";
import { signOut } from "@/app/actions/auth";

/** Sign-out form that also stops this device's push notifications, so a shared phone
 * doesn't keep receiving the previous person's alerts. */
export function SignOutForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const ready = useRef(false);
  return (
    <form
      ref={ref}
      action={signOut}
      className={className}
      onSubmit={async (e) => {
        if (ready.current) return;
        e.preventDefault();
        ready.current = true;
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          if (sub) {
            (ref.current?.elements.namedItem("endpoint") as HTMLInputElement | null)?.setAttribute("value", sub.endpoint);
            await sub.unsubscribe();
          }
        } catch {
          // Signing out matters more than tidying up push.
        }
        ref.current?.requestSubmit();
      }}
    >
      <input type="hidden" name="endpoint" />
      {children}
    </form>
  );
}
