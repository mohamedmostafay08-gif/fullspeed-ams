"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { signIn, type SignInState } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/client";

export function LoginForm() {
  const t = useT();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, undefined);
  const [show, setShow] = useState(false);

  return (
    <form action={action} method="post" className="mt-8 space-y-4">
      <div>
        <label className="label" htmlFor="email">{t("الإيميل")}</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          defaultValue={state?.email}
          placeholder="name@fullspeedlogistics.com"
          className="input text-left"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">{t("كلمة السر")}</label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            required
            dir="ltr"
            autoComplete="current-password"
            className="input pl-11 text-left"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 left-0 grid w-11 place-items-center text-zinc-400 hover:text-zinc-600"
            aria-label={show ? t("إخفاء كلمة السر") : t("إظهار كلمة السر")}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      <button className="btn-primary w-full py-3 text-base" disabled={pending}>
        {pending ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
        {pending ? t("جاري الدخول...") : t("دخول")}
      </button>
    </form>
  );
}
