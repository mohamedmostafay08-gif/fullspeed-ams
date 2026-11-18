import "server-only";
import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";

export type PushConfig = { publicKey: string; privateKey: string; dispatchSecret: string };

let cached: PushConfig | null = null;

/** VAPID keys are created on first use and kept in the private config table (never in env or the repo). */
export async function getPushConfig(): Promise<PushConfig | null> {
  if (cached) return cached;
  if (!hasServiceKey()) return null;
  const db = createAdminClient();
  const { data, error } = await db.rpc("push_config");
  if (error) return null;
  const cfg = (data ?? {}) as Record<string, string>;
  let vapid = cfg.vapid;
  if (!vapid) {
    const k = webpush.generateVAPIDKeys();
    const { data: stored } = await db.rpc("init_push_config", { p_key: "vapid", p_value: `${k.publicKey}:${k.privateKey}` });
    vapid = stored as string;
  }
  if (!vapid || !cfg.dispatch_secret) return null;
  const [publicKey, privateKey] = vapid.split(":");
  cached = { publicKey, privateKey, dispatchSecret: cfg.dispatch_secret };
  return cached;
}

export function secretMatches(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getPushPublicKey(): Promise<string | null> {
  try {
    return (await getPushConfig())?.publicKey ?? null;
  } catch {
    return null;
  }
}
