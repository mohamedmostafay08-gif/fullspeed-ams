"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient, joinPresence } from "@/lib/supabase/client";

/** Marks the agent as online for the live board while any agent page is open. */
export function PresenceBeacon({ userId }: { userId: string }) {
  const path = usePathname();
  useEffect(() => joinPresence(userId, { id: userId, path, at: new Date().toISOString() }, () => {}), [userId, path]);
  return null;
}

/** Records attendance (first and last time seen today) every 5 minutes while the app is open. */
export function AttendanceBeacon() {
  useEffect(() => {
    const supabase = createClient();
    const ping = () => {
      if (document.visibilityState === "visible") void supabase.rpc("touch_attendance").then(() => {});
    };
    ping();
    const timer = setInterval(ping, 5 * 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
  return null;
}
