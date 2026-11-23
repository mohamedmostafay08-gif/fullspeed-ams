"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Shown instead of a blank crash page when something breaks while loading a page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <div className="card space-y-4 py-10">
        <p className="text-5xl" aria-hidden>😕</p>
        <h1 className="text-xl font-extrabold">{t("حصلت مشكلة في الصفحة دي")}</h1>
        <p className="text-sm text-zinc-500">{t("جرّب تاني، ولو المشكلة فضلت كلّم الأدمن.")}</p>
        {error.digest && <p className="num text-xs text-zinc-400">#{error.digest}</p>}
        <div className="flex justify-center gap-2">
          <button onClick={reset} className="btn-primary"><RotateCcw size={16} /> {t("جرّب تاني")}</button>
          <Link href="/" className="btn-ghost">{t("الرئيسية")}</Link>
        </div>
      </div>
    </div>
  );
}
