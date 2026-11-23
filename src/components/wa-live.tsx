"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { subscribeAsUser } from "@/lib/supabase/client";

/** Refreshes the page when a WhatsApp message or conversation changes (row-level security limits what arrives). */
export function WaLive({ channel, phone }: { channel: string; phone?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 500);
    };
    const unsubscribe = subscribeAsUser(`wa:${channel}`, (ch) =>
      phone
        ? ch.on("postgres_changes", { event: "*", schema: "public", table: "wa_messages", filter: `phone=eq.${phone}` }, refresh)
        : ch.on("postgres_changes", { event: "*", schema: "public", table: "wa_threads" }, refresh),
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
    };
  }, [channel, phone, router]);
  return null;
}
