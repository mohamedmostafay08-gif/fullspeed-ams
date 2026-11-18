"use server";

import { getProfile } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(sub: Sub, userAgent: string) {
  const profile = await getProfile();
  if (!profile) return { error: "auth" };
  if (!/^https:\/\//.test(sub?.endpoint ?? "") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "invalid" };
  const row = {
    user_id: profile.id,
    endpoint: sub.endpoint.slice(0, 1000),
    p256dh: sub.keys.p256dh.slice(0, 200),
    auth: sub.keys.auth.slice(0, 100),
    locale: await getLocale(),
    user_agent: userAgent.slice(0, 300),
  };
  // A browser endpoint is unique to that browser; if someone else signed in on it before, it now belongs to this user.
  const db = hasServiceKey() ? createAdminClient() : await createClient();
  const { error } = await db.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  return error ? { error: "save" } : { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Sends a test notification to all of the caller's devices (through the normal pipeline). */
export async function sendTestPush() {
  const profile = await getProfile();
  if (!profile || !hasServiceKey()) return { error: "config" };
  const { error } = await createAdminClient()
    .from("notifications")
    .insert({ user_id: profile.id, type: "info", title: "🔔 تجربة الإشعارات", body: "لو شايف الرسالة دي يبقى الإشعارات شغالة على الجهاز ده", link: profile.role === "agent" ? "/agent" : "/admin" });
  return error ? { error: "send" } : { ok: true };
}
