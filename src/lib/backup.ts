import "server-only";
import { cairoToday } from "@/lib/auth";
import { getConfig, setConfig } from "@/lib/app-config";
import { createAdminClient } from "@/lib/supabase/admin";

const KEEP_DAYS = 30;

export type BackupResult = { file: string; bytes: number; drive: "skipped" | "ok" | "error"; driveError?: string };

/**
 * Saves the database's own export (every business table plus account e-mails) as one gzipped JSON
 * file in the private "backups" bucket. The bytes are only streamed and compressed here, never parsed,
 * so the work stays tiny however big the data gets. The table list lives in private.backup_tables().
 */
export async function runBackup(options: { withDrive?: boolean } = {}): Promise<BackupResult> {
  const db = createAdminClient();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/backup_export`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  if (!res.ok || !res.body) throw new Error(`export ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = new Uint8Array(await new Response(res.body.pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const file = `fullspeed-${cairoToday()}.json.gz`;
  const { error } = await db.storage.from("backups").upload(file, body, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);

  // Keep the last 30 days.
  const { data: files } = await db.storage.from("backups").list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  const old = (files ?? []).filter((f) => f.name.endsWith(".json.gz")).slice(KEEP_DAYS).map((f) => f.name);
  if (old.length) await db.storage.from("backups").remove(old);

  const result: BackupResult = { file, bytes: body.length, drive: "skipped" };
  // Google Drive gets the same gzipped file. The database posts it (drive_backup_send), so this
  // request never waits on Apps Script, and the morning check reads Google's answer.
  const cfg = await getConfig();
  if (cfg.drive_script_url && cfg.drive_secret && options.withDrive !== false) {
    const { error: driveError } = await db.rpc("drive_backup_send", { p_name: file, p_data: Buffer.from(body).toString("base64") });
    Object.assign(result, driveError ? { drive: "error", driveError: driveError.message } : { drive: "ok" });
  }
  // Read by the database's morning check, which alerts the admin when a backup is missing.
  await setConfig("last_backup_at", new Date().toISOString());
  return result;
}
