import "server-only";
import { headers } from "next/headers";
import { deviceLabel } from "@/lib/passkeys";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";

/** Records a sign-in for the admin's sign-in log. Never blocks or fails the sign-in. */
export async function recordLogin(userId: string, method: "password" | "passkey") {
  await write({ user_id: userId, method, success: true }, userId);
}

/** Records a wrong e-mail/password attempt (who tried which address, from where). */
export async function recordFailedLogin(email: string) {
  await write({ user_id: null, method: "password", success: false, email: email.slice(0, 200) });
}

async function write(row: Record<string, unknown>, actorId?: string) {
  if (!hasServiceKey()) return;
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await createAdminClient(actorId).from("login_events").insert({ ...row, ip, device: deviceLabel(ua), user_agent: ua.slice(0, 400) });
  } catch {
    // The log is best-effort.
  }
}
