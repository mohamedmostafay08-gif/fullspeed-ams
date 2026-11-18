"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// The unread count comes from the server; realtime events just trigger a refresh.
export function NotificationBell({ userId, initial: count, href }: { userId: string; initial: number; href: string }) {
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setToast(String((payload.new as { title?: string }).title ?? "إشعار جديد"));
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <Link href={href} className="relative rounded-full p-2 text-zinc-500 hover:bg-zinc-100" aria-label="الإشعارات">
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-5 rounded-full bg-brand-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
      {toast && (
        <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
          🔔 {toast}
        </div>
      )}
    </>
  );
}
