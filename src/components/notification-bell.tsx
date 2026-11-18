"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { subscribeAsUser } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";

// The unread count comes from the server; realtime events just trigger a refresh.
export function NotificationBell({ userId, initial: count, href }: { userId: string; initial: number; href: string }) {
  const t = useT();
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  useEffect(
    () =>
      subscribeAsUser(`notifications:${userId}`, (channel) =>
        channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            setToast(String((payload.new as { title?: string }).title ?? t("إشعار جديد")));
            router.refresh();
          },
        ),
      ),
    [userId, router],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <Link href={href} className="relative rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-ink" aria-label={t("الإشعارات")}>
        <Bell size={20} />
        {count > 0 && (
          <span className="num absolute -top-0.5 -left-0.5 min-w-5 rounded-full bg-brand-600 px-1 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
      {toast &&
        createPortal(
        <div
          role="status"
          className="fixed bottom-20 left-4 z-50 flex max-w-sm animate-rise items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-2xl shadow-ink/30 md:bottom-6 md:left-6"
        >
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-600">
            <Bell size={14} />
          </span>
          <Link href={href} onClick={() => setToast(null)} className="flex-1 leading-6 font-semibold">{toast}</Link>
          <button onClick={() => setToast(null)} className="text-slate-ink hover:text-white" aria-label={t("إغلاق")}>
            <X size={16} />
          </button>
        </div>,
          // Portalled: the sticky header's backdrop-filter would otherwise anchor this "fixed" toast to the header.
          document.body,
        )}
    </>
  );
}
