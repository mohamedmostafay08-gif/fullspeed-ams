import "server-only";
import { headers } from "next/headers";
import { deviceLabel } from "@/lib/passkeys";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";

/** Records a successful sign-in for the admin's sign-in log. Never blocks or fails the sign-in. */
export async function recordLogin(userId: string, method: "password" | "passkey") {
  if (!hasServiceKey()) return;
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await createAdminClient(userId).from("login_events").insert({
      user_id: userId,
      method,
      ip,
      device: deviceLabel(ua),
      user_agent: ua.slice(0, 400),
    });
  } catch {
    // The log is best-effort.
  }
}
