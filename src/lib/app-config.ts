import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/admin";
import { secretMatches } from "@/lib/push";

/** Private key/value settings (service role only — never sent to the browser as-is). */
export async function getConfig(): Promise<Record<string, string>> {
  if (!hasServiceKey()) return {};
  const { data } = await createAdminClient().rpc("push_config");
  return (data ?? {}) as Record<string, string>;
}

export async function setConfig(key: string, value: string) {
  await createAdminClient().rpc("set_push_config", { p_key: key, p_value: value });
}

/** Creates a random value once and returns the stored one afterwards. */
export async function ensureSecret(key: string) {
  const { data } = await createAdminClient().rpc("init_push_config", { p_key: key, p_value: randomBytes(24).toString("hex") });
  return data as string;
}

/** Requests coming from the database scheduler carry the shared dispatch secret. */
export async function fromDatabase(request: Request) {
  const cfg = await getConfig();
  return Boolean(cfg.dispatch_secret) && secretMatches(request.headers.get("x-dispatch-secret"), cfg.dispatch_secret);
}
