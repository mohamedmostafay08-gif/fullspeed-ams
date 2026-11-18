"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/app/admin/actions";

export function StateForm({
  action,
  children,
  className,
  submitLabel = "حفظ",
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  submitLabel?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3 pt-1 sm:col-span-full">
        <button className="btn-primary" disabled={pending}>{pending ? "جاري..." : submitLabel}</button>
        {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      </div>
    </form>
  );
}
