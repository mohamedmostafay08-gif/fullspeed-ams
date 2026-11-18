"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { joinPresence } from "@/lib/supabase/client";

/** Marks the agent as online for the live board while any agent page is open. */
export function PresenceBeacon({ userId }: { userId: string }) {
  const path = usePathname();
  useEffect(() => joinPresence(userId, { id: userId, path, at: new Date().toISOString() }, () => {}), [userId, path]);
  return null;
}
