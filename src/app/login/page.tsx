"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Zap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setError("الإيميل أو كلمة السر غلط");
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <span className="rounded-xl bg-brand-600 p-2 text-white">
            <Zap size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold">Full Speed</h1>
            <p className="text-xs text-zinc-500">نظام فريق الأكوزيشن</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">الإيميل</label>
          <input id="email" name="email" type="email" required dir="ltr" className="input" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">كلمة السر</label>
          <input id="password" name="password" type="password" required dir="ltr" className="input" autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </main>
  );
}
