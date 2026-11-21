import "server-only";
import { createClient } from "@supabase/supabase-js";

export const MISSING_SERVICE_KEY = "مفتاح السيرفر SUPABASE_SERVICE_ROLE_KEY مش متضاف في إعدادات Netlify — ضيفه واعمل Trigger deploy";

export function hasServiceKey() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Service-role client: bypasses RLS. Only use after checking the caller's role.
// Pass the signed-in user's id as `actorId` when writing on their behalf, so the activity
// log records who did it instead of "System".
export function createAdminClient(actorId?: string) {
  if (!hasServiceKey()) throw new Error(MISSING_SERVICE_KEY);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(actorId ? { global: { headers: { "x-actor-id": actorId } } } : {}),
  });
}
