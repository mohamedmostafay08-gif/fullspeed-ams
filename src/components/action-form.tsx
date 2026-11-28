"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/actions";
import { useT } from "@/lib/i18n/client";

/** A plain form whose own buttons submit it, with the action's error shown right under it. */
export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  /** Lets inputs elsewhere on the page join this form with `form={id}`. */
  id?: string;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form id={id} action={formAction} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state?.error && <p role="alert" className="w-full text-sm font-semibold text-rose-600">⚠️ {t(state.error)}</p>}
      {state?.ok && <p role="status" className="w-full text-sm font-semibold text-emerald-600">{t(state.ok)}</p>}
    </form>
  );
}
