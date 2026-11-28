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
  // Google Drive gets the same gzipped file, posted from here so the result is known right away
  // (the database's own HTTP client kept hanging on this call). The answer is stored where the
  // morning check and the integrations page read it.
  const cfg = await getConfig();
  if (cfg.drive_script_url && cfg.drive_secret && options.withDrive !== false) {
    const drive = await sendToDrive(cfg.drive_script_url, cfg.drive_secret, file, body);
    Object.assign(result, drive.ok ? { drive: "ok" } : { drive: "error", driveError: drive.error });
  }
  // Read by the database's morning check, which alerts the admin when a backup is missing.
  await setConfig("last_backup_at", new Date().toISOString());
  return result;
}

/** Posts the file to the admin's Apps Script and records Google's answer (drive_backup_* in app_config). */
async function sendToDrive(url: string, secret: string, name: string, bytes: Uint8Array) {
  const req = Date.now();
  let code: number | null = null;
  let text = "";
  let error: string | null = null;
  try {
    // Apps Script answers a POST with a redirect to the script's output, which fetch follows.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, name, data: Buffer.from(bytes).toString("base64") }),
      signal: AbortSignal.timeout(45_000),
    });
    code = res.status;
    text = (await res.text()).slice(0, 300);
    let reply: { ok?: boolean; error?: string } = {};
    try { reply = JSON.parse(text); } catch {}
    if (!res.ok) error = `HTTP ${res.status}`;
    else if (reply.ok !== true) error = reply.error || text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "no reply";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ok = !error;
  await Promise.all([
    setConfig("drive_backup_request", String(req)),
    setConfig("drive_backup_at", new Date().toISOString()),
    setConfig("drive_backup_result", JSON.stringify({ req, code, ok, error, body: ok ? "" : text, at: new Date().toISOString() })),
  ]);
  return { ok, error: error ?? "" };
}
