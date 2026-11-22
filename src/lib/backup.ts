import "server-only";
import { gzipSync } from "node:zlib";
import { cairoToday } from "@/lib/auth";
import { getConfig, setConfig } from "@/lib/app-config";
import { createAdminClient } from "@/lib/supabase/admin";

const TABLES = [
  "governorates", "regions", "teams", "team_companies", "profiles", "companies", "company_governorates", "agent_companies",
  "work_locations", "work_settings", "daily_targets", "leads", "lead_activities", "lead_documents", "call_logs", "tasks",
  "company_announcements", "agent_breaks", "whatsapp_templates", "blacklist", "attendance", "broadcasts", "broadcast_reads",
  "admin_requests", "geo_checkins", "login_events", "audit_log",
];
const KEEP_DAYS = 30;
const PAGE = 1000;

export type BackupResult = { file: string; bytes: number; rows: number; drive: "skipped" | "ok" | "error"; driveError?: string };

/** Exports every business table (plus account e-mails) to one gzipped JSON file in the private "backups" bucket. */
export async function runBackup(): Promise<BackupResult> {
  const db = createAdminClient();
  const data: Record<string, unknown[]> = {};
  let rows = 0;
  for (const table of TABLES) {
    const all: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      all.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }
    data[table] = all;
    rows += all.length;
  }
  const users: { id: string; email: string | undefined }[] = [];
  for (let page = 1; ; page++) {
    const { data: list } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    users.push(...(list?.users ?? []).map((u) => ({ id: u.id, email: u.email })));
    if (!list || list.users.length < 1000) break;
  }

  const body = gzipSync(JSON.stringify({ app: "fullspeed-ams", created_at: new Date().toISOString(), users, tables: data }));
  const file = `fullspeed-${cairoToday()}.json.gz`;
  const { error } = await db.storage.from("backups").upload(file, body, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);

  // Keep the last 30 days.
  const { data: files } = await db.storage.from("backups").list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  const old = (files ?? []).filter((f) => f.name.endsWith(".json.gz")).slice(KEEP_DAYS).map((f) => f.name);
  if (old.length) await db.storage.from("backups").remove(old);

  const result: BackupResult = { file, bytes: body.length, rows, drive: "skipped" };
  const cfg = await getConfig();
  if (cfg.drive_script_url && cfg.drive_secret) {
    try {
      const res = await fetch(cfg.drive_script_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: cfg.drive_secret, name: file, data: body.toString("base64") }),
        redirect: "follow",
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (out.ok) result.drive = "ok";
      else Object.assign(result, { drive: "error", driveError: out.error ?? `HTTP ${res.status}` });
    } catch (e) {
      Object.assign(result, { drive: "error", driveError: e instanceof Error ? e.message : "network" });
    }
  }
  // Read by the database's morning check, which alerts the admin when a backup is missing.
  await setConfig("last_backup_at", new Date().toISOString());
  await setConfig("last_backup_drive", result.drive);
  return result;
}
